export const MCP_ERROR_CODES = [
  "not_found",
  "validation_error",
  "not_allowed",
  "scope_missing",
  "capability_missing",
  "conflict",
  "cross_tenant_denied",
  "rate_limited",
  "human_confirmation_required",
  "human_action_required",
  "provider_unavailable",
  "credential_not_found",
  "model_not_found",
  "model_deprecated",
  "model_incompatible",
  "integration_not_configured",
] as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

export class McpToolError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

const SECRET_KEYS = new Set([
  "api_key",
  "token",
  "secret",
  "ciphertext",
  "credential_value",
  "refresh_token",
  "access_token",
  "client_secret",
  "private_key",
  "authorization",
]);

function redactSecretText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|credential[_-]?value|ciphertext|secret)\s*[:=]\s*["']?[^\s,"'}]+/gi,
      "$1=[redacted]",
    );
}

/** Última cerca de saída: nenhuma tool MCP pode devolver material de credencial. */
export function sanitizeMcpPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMcpPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SECRET_KEYS.has(key.toLowerCase()) ? "[redacted]" : sanitizeMcpPayload(nested),
      ]),
    );
  }
  return typeof value === "string" ? redactSecretText(value) : value;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown_error";
  return redactSecretText(message).slice(0, 500);
}

export function mcpErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof McpToolError) {
    return {
      error: {
        code: error.code,
        message: safeMessage(error),
        details: sanitizeMcpPayload(error.details),
      },
    };
  }
  const message = safeMessage(error);
  const policy = /^(scope_missing|capability_missing|not_allowed):/.exec(message);
  return {
    error: {
      code: policy?.[1] ?? "not_allowed",
      message,
    },
  };
}
