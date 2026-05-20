import test from "node:test";
import assert from "node:assert/strict";
import { splitModel } from "../src/model-resolver.mjs";
import { containsSecretLikeValue, redactText } from "../src/security/redact.mjs";

test("splitModel parses provider/model", () => {
  assert.deepEqual(splitModel("openai/gpt-5.5"), {
    providerID: "openai",
    modelID: "gpt-5.5",
    model: "openai/gpt-5.5",
  });
});

test("splitModel rejects incomplete models", () => {
  assert.equal(splitModel("gpt-5.5"), null);
  assert.equal(splitModel("openai/"), null);
  assert.equal(splitModel("/gpt-5.5"), null);
});

test("redaction removes token-looking strings", () => {
  const value = "OPENAI_API_KEY=sk-abcdefghijklmnop Bearer abcdefghijklmnop";
  const redacted = redactText(value);
  assert.equal(redacted.includes("sk-abcdefghijklmnop"), false);
  assert.equal(redacted.includes("Bearer abcdefghijklmnop"), false);
  assert.equal(containsSecretLikeValue(value), true);
});
