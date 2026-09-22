import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit }));

import type { McpAuthResult } from "@/lib/mcp/auth";
import { enforceMcpToolRateLimit, limitMcpRequest } from "@/lib/mcp/rate-limit";
import type { McpToolDefinition } from "@/lib/mcp/types";

const auth: McpAuthResult = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  role: "manager",
  actor: {
    type: "api_token",
    id: "00000000-0000-4000-8000-000000000002",
    role: "manager",
  },
  apiTokenId: "00000000-0000-4000-8000-000000000002",
  scopes: ["mcp:read", "mcp:write"],
};

const tool = (category: McpToolDefinition["category"]): McpToolDefinition => ({
  name: `crm_${category}_fixture`,
  description: "fixture",
  inputSchema: {},
  category,
  requiresRole: "manager",
  requiresScope: category === "read" ? "mcp:read" : "mcp:write",
  handler: async () => ({}),
});

describe("rate limit do MCP", () => {
  beforeEach(() => checkRateLimit.mockReset());

  it("limita primeiro por token e depois pelo agregado da organização", async () => {
    checkRateLimit
      .mockResolvedValueOnce({ allowed: true, count: 1, limit: 60, window_sec: 60 })
      .mockResolvedValueOnce({ allowed: false, count: 601, limit: 600, window_sec: 60 });

    await expect(limitMcpRequest(auth)).resolves.toMatchObject({
      allowed: false,
      dimension: "organization",
      limit: 600,
    });
    expect(checkRateLimit.mock.calls.map(([bucket]) => bucket)).toEqual([
      `mcp:request:token:${auth.apiTokenId}`,
      `mcp:request:organization:${auth.organizationId}`,
    ]);
  });

  it("não usa bearer plaintext nas chaves", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, count: 61, limit: 60, window_sec: 60 });
    await limitMcpRequest(auth);
    expect(JSON.stringify(checkRateLimit.mock.calls)).not.toContain("dsk_");
  });

  it("não cobra leitura do orçamento de escrita", async () => {
    await enforceMcpToolRateLimit(auth, tool("read"));
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("barra write e handoff depois do teto menor", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, count: 31, limit: 30, window_sec: 60 });
    await expect(enforceMcpToolRateLimit(auth, tool("write"))).rejects.toMatchObject({
      code: "rate_limited",
      details: { dimension: "write", limit: 30, retry_after_seconds: 60 },
    });
    await expect(enforceMcpToolRateLimit(auth, tool("handoff"))).rejects.toMatchObject({
      code: "rate_limited",
    });
  });
});
