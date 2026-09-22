import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";

import { McpToolError } from "./errors";
import type { McpAuthResult } from "./auth";
import type { McpToolDefinition } from "./types";

export const MCP_RATE_LIMITS = {
  tokenPerMinute: 60,
  organizationPerMinute: 600,
  writesPerTokenPerMinute: 30,
  windowSeconds: 60,
} as const;

export interface McpRateLimitDecision {
  allowed: boolean;
  dimension: "token" | "organization" | "write";
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

/** Limite da borda HTTP. A chave usa IDs resolvidos, nunca o bearer plaintext. */
export async function limitMcpRequest(auth: McpAuthResult): Promise<McpRateLimitDecision> {
  const token = await checkRateLimit(
    `mcp:request:token:${auth.apiTokenId}`,
    MCP_RATE_LIMITS.tokenPerMinute,
    MCP_RATE_LIMITS.windowSeconds,
  );
  if (!token.allowed) {
    return {
      allowed: false,
      dimension: "token",
      count: token.count,
      limit: token.limit,
      retryAfterSeconds: token.window_sec,
    };
  }

  const organization = await checkRateLimit(
    `mcp:request:organization:${auth.organizationId}`,
    MCP_RATE_LIMITS.organizationPerMinute,
    MCP_RATE_LIMITS.windowSeconds,
  );
  return {
    allowed: organization.allowed,
    dimension: "organization",
    count: organization.count,
    limit: organization.limit,
    retryAfterSeconds: organization.window_sec,
  };
}

/** Escritas têm um orçamento menor e agregado por token, independente da tool. */
export async function enforceMcpToolRateLimit(
  auth: McpAuthResult,
  tool: McpToolDefinition,
): Promise<void> {
  if (tool.category === "read") return;
  const write = await checkRateLimit(
    `mcp:write:token:${auth.apiTokenId}`,
    MCP_RATE_LIMITS.writesPerTokenPerMinute,
    MCP_RATE_LIMITS.windowSeconds,
  );
  if (!write.allowed) {
    throw new McpToolError("rate_limited", "rate_limited", {
      dimension: "write",
      limit: write.limit,
      retry_after_seconds: write.window_sec,
    });
  }
}
