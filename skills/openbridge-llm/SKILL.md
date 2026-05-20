---
name: openbridge-llm
description: Use when a repo/tool asks for OpenAI, Anthropic, Ollama, Claude, LLM provider keys, base URLs, API keys, or model configuration; route it through OpenBridgeLLM instead of raw provider secrets.
---

# OpenBridgeLLM

Use OpenBridgeLLM when a tool wants an LLM provider, model name, API key, or base URL and the user wants to reuse their current OpenCode model/auth path.

## Rule

Do not configure raw provider credentials in third-party tools. Start OpenBridgeLLM and point the tool at the local compatibility endpoint.

## Commands

```bash
openbridge up
openbridge env
openbridge health
openbridge models
openbridge cleanup
openbridge down
```

Run tools with injected provider-compatible environment variables:

```bash
openbridge with <command...>
```

## Provider Shapes

OpenAI-compatible tools:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:43117/v1
export OPENAI_API_KEY=<openbridge-local-token>
```

Anthropic-compatible tools:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:43117
export ANTHROPIC_API_KEY=<openbridge-local-token>
```

Ollama-compatible tools:

```bash
export OLLAMA_HOST=http://127.0.0.1:43117
```

## Behavior

- Requested model names are masked by default.
- The actual model is resolved from OpenCode at call time.
- Raw provider keys stay inside OpenCode and are never copied to tools.
- Temporary OpenCode sessions are named `openbridge:*` and cleaned up through official OpenCode APIs.

## Caveat

OpenBridgeLLM translates API shape. It does not give a selected model capabilities it does not have. A small local model will not become Claude Opus because a tool asked for Claude.
