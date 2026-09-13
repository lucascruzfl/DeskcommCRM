/** Rate limit leve por token e classe de risco do MCP. */
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import type { McpPublicRisk } from "./public-profile";

export const MCP_RATE_LIMITS = {
  read: { limit: 60, window_sec: 60 },
  write: { limit: 30, window_sec: 60 },
  critical: { limit: 10, window_sec: 60 },
} as const;

export class McpRateLimitError extends Error {
  readonly code = "rate_limited";

  constructor(public readonly retryAfterSeconds: number) {
    super(`rate_limited: retry_after_seconds=${retryAfterSeconds}`);
    this.name = "McpRateLimitError";
  }
}

export async function enforceMcpRateLimit(tokenId: string, risk: McpPublicRisk): Promise<void> {
  const policy = MCP_RATE_LIMITS[risk];
  const result = await checkRateLimit(
    `mcp:${tokenId}:${risk}`,
    policy.limit,
    policy.window_sec,
  );
  if (!result.allowed) {
    const elapsed = Math.floor(Date.now() / 1000) % policy.window_sec;
    throw new McpRateLimitError(Math.max(1, policy.window_sec - elapsed));
  }
}
