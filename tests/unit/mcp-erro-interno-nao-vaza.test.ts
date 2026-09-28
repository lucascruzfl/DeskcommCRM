import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it, vi } from "vitest";
import type { McpAuthResult } from "@/lib/mcp/auth";

const auditSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: auditSpy }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/mcp/rate-limit", () => ({ verificarTetoMcp: async () => {} }));
vi.mock("@/lib/mcp/tools", () => {
  const definition = {
    name: "crm_search_contacts",
    description: "Consulta contatos",
    inputSchema: {},
    category: "read",
    requiresRole: "manager",
    requiresScope: "mcp:read",
    domain: "contacts",
    handler: async () => {
      throw new Error("SQL falhou em db-private-origin.invalid");
    },
  };
  return { allTools: [definition], getToolByName: (name: string) => name === definition.name ? definition : undefined };
});

const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");
const { createMcpServer } = await import("@/lib/mcp/server");

const auth = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  role: "manager",
  actor: { type: "ai_agent", id: "00000000-0000-4000-8000-000000000002", role: "manager" },
  apiTokenId: "00000000-0000-4000-8000-000000000003",
  scopes: ["mcp:read"],
} as McpAuthResult;

it("falha técnica não sai para o modelo, para o MCP público nem para o audit", async () => {
  const montadas = pickToolsFromMcp({
    supabase: {} as never,
    ctx: { ...auth, requestId: "req-1", supabase: {} } as never,
    auth,
    toolIds: ["crm_search_contacts"],
    handoffToolEnabled: false,
    handoffSignal: { triggered: false },
  });
  const { execute } = montadas.crm_search_contacts as unknown as {
    execute: (args: unknown) => Promise<unknown>;
  };
  expect(await execute({})).toEqual({ error: "Tool execution failed." });

  const server = createMcpServer(auth, "req-2");
  const [cliente, servidor] = InMemoryTransport.createLinkedPair();
  await server.connect(servidor);
  const client = new Client({ name: "teste", version: "0.0.0" });
  await client.connect(cliente);
  const resultado = await client.callTool({ name: "crm_search_contacts", arguments: {} });
  await client.close();

  expect(resultado.isError).toBe(true);
  expect(JSON.stringify(resultado)).not.toContain("db-private-origin.invalid");
  expect(auditSpy).toHaveBeenCalledTimes(2);
  for (const [evento] of auditSpy.mock.calls) {
    expect(evento).toMatchObject({ success: false, errorMessage: "Tool execution failed." });
    expect(JSON.stringify(evento)).not.toContain("db-private-origin.invalid");
  }
});
