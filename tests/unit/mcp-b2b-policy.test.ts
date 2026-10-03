import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn() }));
vi.mock("@/lib/mcp/rate-limit", () => ({ verificarTetoMcp: vi.fn() }));

import { MANAGED_CLIENT_PRESETS } from "@/lib/managed-clients/presets";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import type { McpAuthResult } from "@/lib/mcp/auth";
import { authorizeTool, domainOf, managedAreaOfTool } from "@/lib/mcp/policy";
import { auditMcpToolCall } from "@/lib/mcp/audit";
import { MCP_REGISTRY, mcpPublicProfile } from "@/lib/mcp/registry";
import { MCP_OPERATION_PRESET } from "@/lib/mcp/scopes";
import { createMcpServer } from "@/lib/mcp/server";
import { catalogEntry, deModuloDesligado } from "@/lib/mcp/tools/catalog";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalog";
import { ligarPacote } from "@/lib/mcp/tools/selecao-por-pacote";
import { TOOLS_B2B } from "@/lib/mcp/tools/catalogo/b2b";

const b2bNames = TOOLS_B2B.map((entry) => entry.name);
const org = "10000000-0000-4000-8000-000000000001";
const token = "20000000-0000-4000-8000-000000000002";
function auth(scopes: string[], role: McpAuthResult["role"] = "manager"): McpAuthResult {
  return {
    organizationId: org,
    role,
    actor: { type: "api_token", id: token, role },
    apiTokenId: token,
    scopes,
  };
}

async function withClient(
  policy: McpAuthResult,
  modules: readonly "crm_b2b"[],
  check: (client: Client) => Promise<void>,
) {
  const server = createMcpServer(policy, "b2b-policy-test", modules);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "b2b-test", version: "0.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await check(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("MCP B2B: catálogo, scopes, módulo e managed policy", () => {
  it("catálogo 1:1, domínio contacts para identidades CRM, área exata e módulo", () => {
    expect(b2bNames).toHaveLength(13);
    for (const name of b2bNames) {
      const tool = MCP_REGISTRY.find((entry) => entry.name === name);
      expect(tool, name).toBeDefined();
      expect(catalogEntry(name)?.modulo).toBe("crm_b2b");
      expect(domainOf(tool!)).toBe("contacts");
      expect(managedAreaOfTool(tool!)).toBe(
        name.includes("import_batch")
          ? "/app/imports"
          : name.includes("compan") && !name.includes("person")
            ? "/app/companies"
            : "/app/people",
      );
      expect(deModuloDesligado(name, [])).toBe(true);
      expect(deModuloDesligado(name, ["crm_b2b"])).toBe(false);
      expect(tool!.redigirErroParaAuditoria?.("email@example.test")).toBe("b2b_tool_error");
    }
  });

  it("módulo OFF omite tools/list e chamada direta; ON oferece ao manager", async () => {
    const manager = auth([...MCP_OPERATION_PRESET]);
    await withClient(manager, [], async (client) => {
      const listed = (await client.listTools()).tools.map((tool) => tool.name);
      expect(listed.filter((name) => b2bNames.includes(name))).toEqual([]);
      const result = await client.callTool({ name: "crm_list_companies", arguments: {} });
      expect(result.isError).toBe(true);
    });
    await withClient(manager, ["crm_b2b"], async (client) => {
      const listed = (await client.listTools()).tools.map((tool) => tool.name);
      for (const name of b2bNames) expect(listed).toContain(name);
    });
  });

  it("erro do serviço não grava valores pessoais no audit universal", async () => {
    const tool = MCP_REGISTRY.find((entry) => entry.name === "crm_create_company")!;
    const original = tool.handler;
    tool.handler = async () => {
      throw new Error("CNPJ 11222333000181 email@example.test");
    };
    try {
      await withClient(auth([...MCP_OPERATION_PRESET]), ["crm_b2b"], async (client) => {
        const result = await client.callTool({
          name: tool.name,
          arguments: { trade_name: "Empresa Secreta" },
        });
        expect(result.isError).toBe(true);
      });
      expect(vi.mocked(auditMcpToolCall)).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: tool.name,
          errorMessage: "b2b_tool_error",
          args: expect.objectContaining({ fields_present: ["trade_name"] }),
        }),
      );
    } finally {
      tool.handler = original;
    }
  });

  it("token de preset completo anterior mantém acesso sem abrir allowlist parcial", () => {
    const oldComplete = MCP_OPERATION_PRESET.filter(
      (scope) => !b2bNames.some((name) => scope === `tool:${name}`),
    );
    const write = MCP_REGISTRY.find((tool) => tool.name === "crm_create_company")!;
    expect(() => authorizeTool(auth([...oldComplete]), write)).not.toThrow();
    expect(() =>
      authorizeTool(auth(["mcp:write", "contacts:write", "tool:crm_create_contact"]), write),
    ).toThrow("not_allowed");
    expect(() =>
      authorizeTool(auth(["mcp:write", "tool:crm_create_company"]), write),
    ).not.toThrow();
  });

  it("role, scope e managed policy não criam bypass", () => {
    const write = MCP_REGISTRY.find((tool) => tool.name === "crm_create_company")!;
    const read = MCP_REGISTRY.find((tool) => tool.name === "crm_list_companies")!;
    expect(
      mcpPublicProfile(auth([...MCP_OPERATION_PRESET], "agent")).some(
        (tool) => tool.name === write.name,
      ),
    ).toBe(false);
    expect(() => authorizeTool(auth(["mcp:write", "contacts:read"]), write)).toThrow(
      "scope_missing:contacts:write",
    );
    expect(() => authorizeTool(auth(["contacts:read"]), read)).toThrow("scope_missing:mcp:read");
    for (const name of b2bNames) {
      const tool = MCP_REGISTRY.find((entry) => entry.name === name)!;
      const weakerRole = tool.category === "write" ? "agent" : "viewer";
      expect(
        mcpPublicProfile(auth([...MCP_OPERATION_PRESET], weakerRole)).some(
          (entry) => entry.name === name,
        ),
        name,
      ).toBe(false);
      expect(() => authorizeTool(auth([]), tool), name).toThrow(
        `scope_missing:${tool.requiresScope}`,
      );
      expect(() => authorizeTool(auth([tool.requiresScope, "pipelines:read"]), tool), name).toThrow(
        `scope_missing:contacts:${tool.category === "write" ? "write" : "read"}`,
      );
    }
    for (const preset of Object.values(MANAGED_CLIENT_PRESETS)) {
      const managed = {
        ...auth([...MCP_OPERATION_PRESET]),
        managedPolicy: buildManagedAreaPolicy(preset.id),
      };
      for (const name of b2bNames) {
        const tool = MCP_REGISTRY.find((entry) => entry.name === name)!;
        expect(() => authorizeTool(managed, tool), `${preset.id}:${name}`).toThrow(
          "managed_area_denied",
        );
      }
      const onlyCompanies = {
        ...auth([...MCP_OPERATION_PRESET]),
        managedPolicy: buildManagedAreaPolicy(preset.id, [
          { href: "/app/companies", classification: "client" },
        ]),
      };
      const list = MCP_REGISTRY.find((entry) => entry.name === "crm_list_companies")!;
      const detail = MCP_REGISTRY.find((entry) => entry.name === "crm_get_company")!;
      expect(() => authorizeTool(onlyCompanies, list)).not.toThrow();
      expect(() => authorizeTool(onlyCompanies, detail)).toThrow("managed_area_denied");
    }
  });
});

it("consultas de lote continuam no MCP externo sem ocupar capacidades de atendimento da IA interna", () => {
  const publicNames = mcpPublicProfile(auth([...MCP_OPERATION_PRESET], "agent")).map(
    (tool) => tool.name,
  );
  const bundle = ligarPacote([], TOOL_CATALOG, "organizar");
  for (const name of ["crm_list_import_batches", "crm_get_import_batch"]) {
    expect(publicNames).toContain(name);
    expect(bundle).not.toContain(name);
    expect(catalogEntry(name)?.apenasHumano).toBe(true);
  }
  for (const name of ["crm_list_companies", "crm_get_company", "crm_list_people", "crm_get_person"])
    expect(bundle).toContain(name);
});
