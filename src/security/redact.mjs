export function redactText(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(sk|ghp|gho|github_pat|xox[baprs])-?[A-Za-z0-9_\-.]{12,}\b/g, "[REDACTED]")
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PRIVATE_KEY|PASSWORD|DATABASE_URL)[A-Z0-9_]*\s*=\s*)\S+/gi, "$1[REDACTED]");
}

export function containsSecretLikeValue(value) {
  const text = String(value ?? "");
  return /Bearer\s+[A-Za-z0-9._~+/=-]+/i.test(text)
    || /\b(sk|ghp|gho|github_pat|xox[baprs])-?[A-Za-z0-9_\-.]{12,}\b/.test(text)
    || /[A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PRIVATE_KEY|PASSWORD|DATABASE_URL)[A-Z0-9_]*\s*=\s*\S{6,}/i.test(text);
}

export function safeErrorMessage(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return redactText(error);
  if (error.message) return redactText(String(error.message));
  return redactText(JSON.stringify(error));
}
