const response = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
  method: "POST",
  headers: {
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: "Say hello from OpenBridgeLLM." }],
  }),
});

console.log(await response.json());
