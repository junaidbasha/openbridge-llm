# OpenBridgeLLM Session Context

## Decision

Create a standalone public project named `OpenBridgeLLM` in repo `junaidbasha/openbridge-llm`.

CLI command: `openbridge`.

Package name: `openbridge-llm`.

License: MIT.

## Goal

Build one reusable local LLM compatibility bridge instead of one wrapper per tool.

```text
Any external tool
  -> fake local provider endpoint/key
  -> OpenBridgeLLM
  -> current OpenCode model/provider/auth path
  -> translated response back to the tool
```

## Supported Faces

- OpenAI: `GET /v1/models`, `POST /v1/chat/completions`.
- Anthropic: `POST /v1/messages`, `POST /v1/messages/count_tokens`.
- Ollama: `GET /api/tags`, `POST /api/chat`, `POST /api/generate`.
- Env launcher: `openbridge with <command...>`.
- OpenCode skill: `skills/openbridge-llm/SKILL.md`.

## Model Behavior

Default mode is `mask`: requested model names are accepted, but actual calls use the resolved current OpenCode model.

Resolution order:

1. `OPENBRIDGE_MODEL`.
2. `OPENCODE_GATEWAY_MODEL` or `OPENCODE_WORKFLOW_MODEL` fallback.
3. Attached/running OpenCode server config.
4. Recent OpenCode session/message metadata from local DB.
5. Fail closed.

Long-term improvement: add an OpenCode plugin that records the last actual provider/model used, then have OpenBridgeLLM read that safe state.

## Security Constraints

- Never copy raw provider keys out of OpenCode.
- Never print raw provider keys.
- Fake local gateway token is allowed for local tool compatibility.
- Bind to localhost by default.
- Redact token-looking output.
- Cleanup only `openbridge:` sessions through official OpenCode SDK APIs.

## Current BuildCode Note

The previous Ruflo-specific experiment in `buildcode-live` is uncommitted and should not be expanded. OpenBridgeLLM now lives in its own sibling folder: `/Users/junaidbasha/Desktop/openbridge-llm`.

If cleanup of `buildcode-live` is desired, ask explicitly before reverting or deleting those uncommitted files.
