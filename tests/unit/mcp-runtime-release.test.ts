import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn() }));
vi.mock("@/lib/mcp/rate-limit", () => ({ verificarTetoMcp: vi.fn() }));

import type { McpAuthResult } from "@/lib/mcp/auth";
import { MCP_OPERATION_PRESET } from "@/lib/mcp/scopes";
import { toolsForAuth } from "@/lib/mcp/registry";
import { deModuloDesligado } from "@/lib/mcp/tools/catalog";
import { createMcpServer } from "@/lib/mcp/server";

const auth: McpAuthResult = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  role: "manager",
  actor: { type: "api_token", id: "22222222-2222-4222-8222-222222222222", role: "manager" },
  apiTokenId: "22222222-2222-4222-8222-222222222222",
  scopes: [...MCP_OPERATION_PRESET],
};

async function withClient(policy: McpAuthResult, check: (client: Client) => Promise<void>) {
  const server = createMcpServer(policy, "release-test");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "release-test", version: "0.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await check(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("release MCP — tools/list pelo transporte real", () => {
  it("lista handlers reais, sem duplicatas e sem número fixo", async () => {
    await withClient(auth, async (client) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names.length - new Set(names).size).toBe(0);
      expect(names.sort()).toEqual(
        toolsForAuth(auth).filter((tool) => !deModuloDesligado(tool.name, [])).map((tool) => tool.name).sort(),
      );
      expect(names).toContain("crm_retomar_lead");
      expect(names).toContain("crm_get_pipeline_forecast");
      expect(names).toContain("crm_create_conversation_draft");
    });
  });
  it("allowlist filtra tools/list e chamada direta fora dela é negada", async () => {
    await withClient({ ...auth, scopes: ["mcp:read", "leads:read", "tool:crm_get_lead"] }, async (client) => {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["crm_get_lead"]);
      const result = await client.callTool({ name: "crm_retomar_lead", arguments: { lead_id: auth.organizationId } });
      expect(result.isError).toBe(true);
    });
  });
});
