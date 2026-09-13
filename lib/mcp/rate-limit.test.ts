import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit }));

import { enforceMcpRateLimit, MCP_RATE_LIMITS, McpRateLimitError } from "./rate-limit";

describe("rate limit MCP por token", () => {
  beforeEach(() => checkRateLimit.mockReset());

  it.each(["read", "write", "critical"] as const)("separa o bucket %s", async (risk) => {
    checkRateLimit.mockResolvedValue({ allowed: true, count: 1 });
    await enforceMcpRateLimit("token-1", risk);
    expect(checkRateLimit).toHaveBeenCalledWith(
      `mcp:token-1:${risk}`,
      MCP_RATE_LIMITS[risk].limit,
      MCP_RATE_LIMITS[risk].window_sec,
    );
  });

  it("critical é mais restritivo que write, que é mais restritivo que read", () => {
    expect(MCP_RATE_LIMITS.critical.limit).toBeLessThan(MCP_RATE_LIMITS.write.limit);
    expect(MCP_RATE_LIMITS.write.limit).toBeLessThan(MCP_RATE_LIMITS.read.limit);
  });

  it("recusa quando o contador do token ultrapassa o teto", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, count: 11 });
    await expect(enforceMcpRateLimit("token-1", "critical")).rejects.toBeInstanceOf(
      McpRateLimitError,
    );
  });
});
