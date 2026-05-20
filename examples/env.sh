#!/usr/bin/env bash
# Run `openbridge env` for the real local token.

export OPENAI_BASE_URL=http://127.0.0.1:43117/v1
export OPENAI_API_KEY=openbridge-local-token

export ANTHROPIC_BASE_URL=http://127.0.0.1:43117
export ANTHROPIC_API_KEY=openbridge-local-token

export OLLAMA_HOST=http://127.0.0.1:43117
