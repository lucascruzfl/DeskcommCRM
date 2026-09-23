import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";

import { McpToolError } from "./errors";
import { McpAuthError, type McpAuthResult } from "./auth";
import type { McpToolCategory, McpToolDefinition } from "./types";

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

/**
 * Contrato anterior da 1.42.0, mantido para chamadas internas. Na borda MCP
 * Full Control o limite token/org já foi cobrado por `limitMcpRequest`; o
 * terceiro argumento evita debitá-lo duas vezes por `tools/call`.
 */
export async function verificarTetoMcp(
  auth: McpAuthResult,
  categoria: McpToolCategory,
  baseJaContada = false,
): Promise<void> {
  if (baseJaContada) {
    await enforceMcpToolRateLimit(auth, { category: categoria } as McpToolDefinition);
    return;
  }
  const token = await checkRateLimit(`mcp:tok:${auth.apiTokenId}`, 60, 60);
  if (!token.allowed) throw new McpAuthError(-32004, 429, "Teto por token excedido. Tente em 60s.");
  const org = await checkRateLimit(`mcp:org:${auth.organizationId}`, 600, 60);
  if (!org.allowed) throw new McpAuthError(-32004, 429, "Teto por organização excedido. Tente em 60s.");
  if (categoria !== "write") return;
  const write = await checkRateLimit(`mcp:w:${auth.apiTokenId}`, 30, 60);
  if (!write.allowed) throw new McpAuthError(-32004, 429, "Teto de escrita excedido. Tente em 60s.");
}
