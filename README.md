# OpenBridgeLLM

OpenBridgeLLM is a local compatibility bridge that lets OpenAI-, Anthropic-, and Ollama-shaped tools use the model/auth path already configured in OpenCode.

```text
Any external tool
  -> local OpenAI/Anthropic/Ollama-compatible endpoint
  -> OpenBridgeLLM
  -> current OpenCode provider/model
  -> compatible response back to the tool
```

OpenBridgeLLM does not export raw provider credentials. Tools receive only a local endpoint and a local fake API token.

## Install

Local development:

```bash
npm install
npm link
```

Future npm usage:

```bash
npm install -g openbridge-llm
```

## Quick Start

```bash
openbridge up
openbridge health
openbridge env
```

Use the printed environment variables with any LLM tool.

OpenAI-compatible:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:43117/v1
export OPENAI_API_KEY=<openbridge-local-token>
```

Anthropic-compatible:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:43117
export ANTHROPIC_API_KEY=<openbridge-local-token>
```

Ollama-compatible:

```bash
export OLLAMA_HOST=http://127.0.0.1:43117
```

Or run a tool through the launcher:

```bash
openbridge with <command...>
```

## Commands

```bash
openbridge up
openbridge down
openbridge status
openbridge health
openbridge models
openbridge env
openbridge logs
openbridge cleanup
openbridge with <command...>
openbridge install-skill --scope project
openbridge install-skill --scope global
```

## API Compatibility

OpenAI:

```text
GET  /v1/models
POST /v1/chat/completions
```

Anthropic:

```text
POST /v1/messages
POST /v1/messages/count_tokens
```

Ollama:

```text
GET  /api/tags
POST /api/chat
POST /api/generate
```

## Model Masking

Default mode is `mask`: if a tool requests `claude-sonnet-4-6` but OpenCode is currently using another configured model, OpenBridgeLLM accepts the request and routes it through OpenCode.

```bash
export OPENBRIDGE_MODEL_MODE=mask
```

Strict mode fails when the requested model does not match the current OpenCode model:

```bash
export OPENBRIDGE_MODEL_MODE=strict
```

Explicit model override:

```bash
export OPENBRIDGE_MODEL=provider/model-id
```

## Security

- Binds to `127.0.0.1` by default.
- Requires a local token for OpenAI and Anthropic routes.
- Does not read OpenCode provider secret stores directly.
- Does not pass provider keys to external tools.
- Redacts token-looking strings in errors and model output.
- Deletes only OpenCode sessions prefixed with `openbridge:` during cleanup.

Ollama clients usually do not send API keys, so Ollama routes allow unauthenticated localhost access by default. Set `OPENBRIDGE_OLLAMA_AUTH=on` to require the local token for those routes too.

## Limits

OpenBridgeLLM translates request and response formats. It cannot create capabilities the selected model does not have. Long context, tool calling, image inputs, Claude thinking blocks, and exact provider-specific behavior are best-effort or deferred.

## License

MIT
