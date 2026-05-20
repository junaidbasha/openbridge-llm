#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { redactText, safeErrorMessage } from "./security/redact.mjs";

const DEFAULT_DB_PATH = `${homedir()}/.local/share/opencode/opencode.db`;

export function splitModel(model) {
  if (!model || typeof model !== "string") return null;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return null;
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1),
    model,
  };
}

export async function resolveOpenCodeModel(options = {}) {
  const explicit = splitModel(process.env.OPENBRIDGE_MODEL || process.env.OPENCODE_GATEWAY_MODEL || process.env.OPENCODE_WORKFLOW_MODEL);
  if (explicit) return { ...explicit, source: "env" };

  const serverUrl = options.serverUrl || process.env.OPENBRIDGE_OPENCODE_SERVER_URL || process.env.OPENCODE_ATTACH_URL;
  if (serverUrl) {
    const fromServerConfig = await resolveFromServerConfig(serverUrl, options.directory);
    if (fromServerConfig) return fromServerConfig;
  }

  const dbPath = options.dbPath || process.env.OPENBRIDGE_OPENCODE_DB_PATH || process.env.OPENCODE_DB_PATH || DEFAULT_DB_PATH;
  const fromDb = resolveFromDatabase(dbPath);
  if (fromDb) return fromDb;

  if (serverUrl) {
    const fromServerDefault = await resolveFromServerDefault(serverUrl, options.directory);
    if (fromServerDefault) return fromServerDefault;
  }

  throw new Error("Unable to resolve an OpenCode model without making a probe model call.");
}

export async function resolveFromServer(serverUrl, directory) {
  return await resolveFromServerConfig(serverUrl, directory) || await resolveFromServerDefault(serverUrl, directory);
}

export async function resolveFromServerConfig(serverUrl, directory) {
  try {
    const client = createOpencodeClient({ baseUrl: serverUrl, headers: basicAuthHeaders(), directory });

    const config = unwrapSdkResult(await client.config.get({ query: { directory } }));
    const configured = splitModel(config?.model);
    if (configured) return { ...configured, source: "opencode-server-config" };
  } catch {
    return null;
  }
  return null;
}

export async function resolveFromServerDefault(serverUrl, directory) {
  try {
    const client = createOpencodeClient({ baseUrl: serverUrl, headers: basicAuthHeaders(), directory });
    const providers = unwrapSdkResult(await client.config.providers({ query: { directory } }));
    const defaults = providers?.default || {};
    for (const [providerID, modelID] of Object.entries(defaults)) {
      if (typeof providerID === "string" && typeof modelID === "string" && providerID && modelID) {
        return { providerID, modelID, model: `${providerID}/${modelID}`, source: "opencode-server-default" };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function resolveFromDatabase(dbPath = DEFAULT_DB_PATH) {
  if (!existsSync(dbPath)) return null;

  let output = "";
  try {
    output = execFileSync("sqlite3", [
      dbPath,
      "SELECT data FROM message WHERE data LIKE '%modelID%' ORDER BY time_created DESC LIMIT 100",
    ], { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
  } catch {
    return null;
  }

  for (const line of output.split("\n").filter(Boolean)) {
    const parsed = parseJson(line);
    const direct = modelFromObject(parsed);
    if (direct) return { ...direct, source: "opencode-message-db" };
  }
  return null;
}

export function unwrapSdkResult(result) {
  if (!result) return null;
  if (result.error) {
    const status = result.response?.status ? `${result.response.status} ${result.response.statusText || ""}`.trim() : "SDK error";
    throw new Error(`${status}: ${safeErrorMessage(result.error)}`);
  }
  if (Object.prototype.hasOwnProperty.call(result, "data")) return result.data;
  return result;
}

function basicAuthHeaders() {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return undefined;
  const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function modelFromObject(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.providerID === "string" && typeof value.modelID === "string") {
    return { providerID: value.providerID, modelID: value.modelID, model: `${value.providerID}/${value.modelID}` };
  }
  if (value.model && typeof value.model === "object") {
    const nested = modelFromObject(value.model);
    if (nested) return nested;
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") {
      const found = modelFromObject(nested);
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  const json = process.argv.includes("--json");
  try {
    const resolved = await resolveOpenCodeModel();
    console.log(json ? JSON.stringify(resolved) : resolved.model);
  } catch (error) {
    const message = safeErrorMessage(error);
    if (json) {
      console.log(JSON.stringify({ error: message }));
    } else {
      console.error(`openbridge model: ${redactText(message)}`);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
