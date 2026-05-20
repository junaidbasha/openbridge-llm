const response = await fetch(`${process.env.OLLAMA_HOST}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "llama3.2",
    stream: false,
    messages: [{ role: "user", content: "Say hello from OpenBridgeLLM." }],
  }),
});

console.log(await response.json());
