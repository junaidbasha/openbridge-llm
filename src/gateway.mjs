#!/usr/bin/env node
import http from "node:http";
import { randomUUID } from "node:crypto";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";
import { resolveOpenCodeModel, unwrapSdkResult } from "./model-resolver.mjs";
import { containsSecretLikeValue, redactText, safeErrorMessage } from "./security/redact.mjs";

const args = parseArgs(process.argv.slice(2));
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const host = args.host || process.env.OPENBRIDGE_HOST || "127.0.0.1";
const port = Number(args.port || process.env.OPENBRIDGE_PORT || 43117);
const token = process.env.OPENBRIDGE_TOKEN || args.token || "";
const repoRoot = process.env.OPENBRIDGE_REPO_ROOT || process.cwd();
const modelMode = process.env.OPENBRIDGE_MODEL_MODE || args.modelMode || "mask";
const maxBodyBytes = Number(process.env.OPENBRIDGE_MAX_BODY_BYTES || 1024 * 1024);
const requestTimeoutMs = Number(process.env.OPENBRIDGE_REQUEST_TIMEOUT_MS || 180000);
const sessionPrefix = "openbridge:";

prependPath(join(packageRoot, "node_modules", ".bin"));
prependPath(join(repoRoot, "node_modules", ".bin"));

if (!token && args.auth !== "off") {
  console.error("openbridge gateway: OPENBRIDGE_TOKEN is required unless --auth=off is set.");
  process.exit(2);
}

let opencodeInstance = null;
let opencodeClient = null;
let opencodeUrl = null;

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    writeJson(res, statusForError(error), { error: { message: safeErrorMessage(error) } });
  }
});

server.on("clientError", (_error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ event: "openbridge_listening", host, port, model: "openbridge-current" }));
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${host}:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    const model = await healthModelStatus();
    writeJson(res, model.error ? 503 : 200, {
      ok: !model.error,
      gateway: "openbridge-llm",
      model: model.error ? null : model,
      modelMode,
      opencodeServer: opencodeUrl,
    });
    return;
  }

  if (!isAuthorized(req) && !isUnauthenticatedOllamaAllowed(url.pathname)) {
    writeJson(res, 401, { error: { message: "Unauthorized" } });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    writeJson(res, 200, openAiModelsResponse());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tags") {
    writeJson(res, 200, ollamaTagsResponse());
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await readJsonBody(req);
    const result = await completeOpenAi(body);
    body.stream ? writeOpenAiStream(res, result) : writeJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/messages") {
    const body = await readJsonBody(req);
    const result = await completeAnthropic(body);
    body.stream ? writeAnthropicStream(res, result) : writeJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/messages/count_tokens") {
    const body = await readJsonBody(req);
    writeJson(res, 200, { input_tokens: estimateTokens(normalizeAnthropicMessages(body)) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJsonBody(req);
    const result = await completeOllamaChat(body);
    body.stream === false ? writeJson(res, 200, result) : writeNdjson(res, [result]);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    const body = await readJsonBody(req);
    const result = await completeOllamaGenerate(body);
    body.stream === false ? writeJson(res, 200, result) : writeNdjson(res, [result]);
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/cleanup-sessions") {
    writeJson(res, 200, await cleanupOpenBridgeSessions());
    return;
  }

  writeJson(res, 404, { error: { message: "Not found" } });
}

async function completeOpenAi(body) {
  if (!body || typeof body !== "object") throw badRequest("Request body must be a JSON object.");
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) throw badRequest("messages must contain at least one message.");

  const completion = await completeCanonical({
    requestedModel: body.model,
    messages: messages.map((message) => ({ role: message.role || "user", content: contentToText(message.content) })),
  });

  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model || "openbridge-current",
    choices: [{ index: 0, message: { role: "assistant", content: completion.text }, finish_reason: completion.finishReason }],
    usage: completion.usage,
  };
}

async function completeAnthropic(body) {
  if (!body || typeof body !== "object") throw badRequest("Request body must be a JSON object.");
  const messages = normalizeAnthropicMessages(body);
  if (!messages.length) throw badRequest("messages must contain at least one message.");

  const completion = await completeCanonical({ requestedModel: body.model, messages });
  return {
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    model: body.model || "openbridge-current",
    content: [{ type: "text", text: completion.text }],
    stop_reason: completion.finishReason === "stop" ? "end_turn" : completion.finishReason,
    stop_sequence: null,
    usage: { input_tokens: completion.usage.prompt_tokens, output_tokens: completion.usage.completion_tokens },
  };
}

async function completeOllamaChat(body) {
  if (!body || typeof body !== "object") throw badRequest("Request body must be a JSON object.");
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) throw badRequest("messages must contain at least one message.");

  const completion = await completeCanonical({
    requestedModel: body.model,
    messages: messages.map((message) => ({ role: message.role || "user", content: contentToText(message.content) })),
  });

  return {
    model: body.model || "openbridge-current",
    created_at: new Date().toISOString(),
    message: { role: "assistant", content: completion.text },
    done: true,
  };
}

async function completeOllamaGenerate(body) {
  if (!body || typeof body !== "object") throw badRequest("Request body must be a JSON object.");
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt) throw badRequest("prompt must be a non-empty string.");

  const completion = await completeCanonical({ requestedModel: body.model, messages: [{ role: "user", content: prompt }] });
  return {
    model: body.model || "openbridge-current",
    created_at: new Date().toISOString(),
    response: completion.text,
    done: true,
  };
}

async function completeCanonical({ requestedModel, messages }) {
  const prompt = normalizeCanonicalMessages(messages);
  if (containsSecretLikeValue(prompt)) throw badRequest("Secret-looking prompt content is blocked by OpenBridgeLLM.");

  const client = await getOpenCodeClient();
  const resolvedModel = await resolveOpenCodeModel({ serverUrl: opencodeUrl || undefined, directory: repoRoot });
  enforceModelMode(requestedModel, resolvedModel);

  const sessionTitle = `${sessionPrefix}${new Date().toISOString()}:${randomUUID().slice(0, 8)}`;
  const session = unwrapSdkResult(await client.session.create({ body: { title: sessionTitle }, query: { directory: repoRoot } }));
  const sessionId = session?.id;
  if (!sessionId) throw new Error("OpenCode session creation did not return a session id.");

  try {
    const response = unwrapSdkResult(await withTimeout(
      client.session.prompt({
        path: { id: sessionId },
        query: { directory: repoRoot },
        body: {
          model: { providerID: resolvedModel.providerID, modelID: resolvedModel.modelID },
          agent: process.env.OPENBRIDGE_OPENCODE_AGENT || "plan",
          tools: { bash: false, edit: false, write: false, patch: false },
          parts: [{ type: "text", text: prompt }],
        },
      }),
      requestTimeoutMs,
      "OpenCode request timed out",
    ));

    const usage = response?.info?.tokens || {};
    return {
      text: redactText(extractText(response?.parts)),
      finishReason: response?.info?.finish || "stop",
      usage: {
        prompt_tokens: Number(usage.input || estimateTokens(prompt)),
        completion_tokens: Number(usage.output || 0),
        total_tokens: Number(usage.input || estimateTokens(prompt)) + Number(usage.output || 0),
      },
      resolvedModel,
    };
  } finally {
    await cleanupSession(client, sessionId);
  }
}

async function getOpenCodeClient() {
  if (opencodeClient) return opencodeClient;

  const attachUrl = process.env.OPENBRIDGE_OPENCODE_SERVER_URL || process.env.OPENCODE_ATTACH_URL;
  if (attachUrl) {
    opencodeUrl = attachUrl;
    opencodeClient = createOpencodeClient({ baseUrl: attachUrl, directory: repoRoot, headers: basicAuthHeaders() });
    return opencodeClient;
  }

  opencodeInstance = await createOpencode({
    hostname: "127.0.0.1",
    port: Number(process.env.OPENBRIDGE_OPENCODE_PORT || 0),
    timeout: Number(process.env.OPENBRIDGE_OPENCODE_START_TIMEOUT_MS || 10000),
    config: { share: "disabled" },
  });
  opencodeUrl = opencodeInstance.server.url;
  opencodeClient = createOpencodeClient({ baseUrl: opencodeUrl, directory: repoRoot, headers: basicAuthHeaders() });
  return opencodeClient;
}

async function cleanupSession(client, sessionId) {
  try {
    await client.session.delete({ path: { id: sessionId }, query: { directory: repoRoot } });
  } catch (error) {
    console.error(redactText(`openbridge: session cleanup failed for ${sessionId}: ${safeErrorMessage(error)}`));
  }
}

async function cleanupOpenBridgeSessions() {
  const client = await getOpenCodeClient();
  const sessions = unwrapSdkResult(await client.session.list({ query: { directory: repoRoot } })) || [];
  const stale = sessions.filter((session) => typeof session?.title === "string" && session.title.startsWith(sessionPrefix));
  const failed = [];
  let deleted = 0;

  for (const session of stale) {
    try {
      await client.session.delete({ path: { id: session.id }, query: { directory: repoRoot } });
      deleted += 1;
    } catch (error) {
      failed.push({ id: session.id, error: safeErrorMessage(error) });
    }
  }

  return { ok: failed.length === 0, matched: stale.length, deleted, failed };
}

async function healthModelStatus() {
  try {
    await getOpenCodeClient();
    return await resolveOpenCodeModel({ serverUrl: opencodeUrl || undefined, directory: repoRoot });
  } catch (error) {
    return { error: safeErrorMessage(error) };
  }
}

function enforceModelMode(requestedModel, resolvedModel) {
  if (!requestedModel || modelMode === "mask" || modelMode === "debug") return;
  if (modelMode !== "strict") throw badRequest(`Unsupported OPENBRIDGE_MODEL_MODE: ${modelMode}`);
  if (requestedModel === "openbridge-current" || requestedModel === resolvedModel.model || requestedModel === resolvedModel.modelID) return;
  throw badRequest(`Requested model '${requestedModel}' does not match current OpenCode model '${resolvedModel.model}'.`);
}

function normalizeCanonicalMessages(messages) {
  return messages.map((message) => `${String(message.role || "user").toUpperCase()}:\n${message.content || ""}`).join("\n\n");
}

function normalizeAnthropicMessages(body) {
  const messages = [];
  if (typeof body?.system === "string" && body.system) messages.push({ role: "system", content: body.system });
  for (const message of Array.isArray(body?.messages) ? body.messages : []) {
    messages.push({ role: message.role || "user", content: contentToText(message.content) });
  }
  return messages;
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      if (typeof part?.content === "string") return part.content;
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

function extractText(parts) {
  if (!Array.isArray(parts)) return "";
  return parts.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim();
}

function openAiModelsResponse() {
  return { object: "list", data: [{ id: "openbridge-current", object: "model", owned_by: "openbridge-llm" }] };
}

function ollamaTagsResponse() {
  return { models: [{ name: "openbridge-current", model: "openbridge-current", modified_at: new Date(0).toISOString(), size: 0 }] };
}

function writeOpenAiStream(res, result) {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const choice = result.choices[0];
  res.write(`data: ${JSON.stringify({ id: result.id, object: "chat.completion.chunk", created: result.created, model: result.model, choices: [{ index: 0, delta: { role: "assistant", content: choice.message.content }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ id: result.id, object: "chat.completion.chunk", created: result.created, model: result.model, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function writeAnthropicStream(res, result) {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const text = result.content?.[0]?.text || "";
  res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { ...result, content: [] } })}\n\n`);
  res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);
  res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`);
  res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
  res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
  res.end();
}

function writeNdjson(res, rows) {
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
  for (const row of rows) res.write(`${JSON.stringify(row)}\n`);
  res.end();
}

function writeJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function isAuthorized(req) {
  if (!token || args.auth === "off") return true;
  const authorization = req.headers.authorization || "";
  const apiKey = req.headers["x-api-key"] || "";
  return authorization === `Bearer ${token}` || apiKey === token;
}

function isUnauthenticatedOllamaAllowed(pathname) {
  if (process.env.OPENBRIDGE_OLLAMA_AUTH === "on") return false;
  return pathname === "/api/tags" || pathname === "/api/chat" || pathname === "/api/generate";
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(badRequest("Request body exceeds OpenBridgeLLM size limit."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(badRequest("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function estimateTokens(value) {
  return Math.ceil(String(value || "").length / 4);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function statusForError(error) {
  return Number(error?.statusCode || 500);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function basicAuthHeaders() {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return undefined;
  const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

function parseArgs(values) {
  const parsed = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (key.includes("=")) {
      const [name, raw] = key.split(/=(.*)/s, 2);
      parsed[name] = raw;
    } else {
      parsed[key] = values[i + 1] && !values[i + 1].startsWith("--") ? values[++i] : "1";
    }
  }
  return parsed;
}

function prependPath(value) {
  if (!process.env.PATH?.split(delimiter).includes(value)) {
    process.env.PATH = `${value}${delimiter}${process.env.PATH || ""}`;
  }
}

async function shutdown() {
  server.close();
  if (opencodeInstance) opencodeInstance.server.close();
  process.exit(0);
}
