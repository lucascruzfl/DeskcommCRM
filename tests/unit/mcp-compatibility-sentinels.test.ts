import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { McpAuthResult } from "@/lib/mcp/auth";
import { sanitizeMcpPayload } from "@/lib/mcp/errors";
import { capabilitiesOf, domainOf } from "@/lib/mcp/policy";
import { MCP_REGISTRY, MCP_TOOL_COUNT, mcpPublicProfile } from "@/lib/mcp/registry";
import {
  MCP_CAPABILITIES,
  MCP_DOMAINS,
  MCP_OPERATION_PRESET,
  isKnownApiTokenScope,
} from "@/lib/mcp/scopes";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalog";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const auth: McpAuthResult = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  role: "manager",
  actor: {
    type: "api_token",
    id: "00000000-0000-4000-8000-000000000002",
    role: "manager",
  },
  apiTokenId: "00000000-0000-4000-8000-000000000002",
  scopes: [...MCP_OPERATION_PRESET],
};

describe("sentinelas de compatibilidade do MCP", () => {
  it("detecta handler removido ou catálogo inconsistente", () => {
    const handlers = MCP_REGISTRY.map((tool) => tool.name).sort();
    const catalog = TOOL_CATALOG.map((tool) => tool.name).sort();
    expect(new Set(handlers).size).toBe(MCP_TOOL_COUNT);
    expect(catalog).toEqual(handlers);
  });

  it("detecta policy, scope, capability ou role inválidos", () => {
    for (const tool of MCP_REGISTRY) {
      expect(["mcp:read", "mcp:write"], tool.name).toContain(tool.requiresScope);
      expect(MCP_DOMAINS, tool.name).toContain(domainOf(tool));
      expect(["viewer", "agent", "ai_operator", "manager"], tool.name).toContain(tool.requiresRole);
      for (const capability of capabilitiesOf(tool))
        expect(MCP_CAPABILITIES, tool.name).toContain(capability);
      expect(
        isKnownApiTokenScope(`${domainOf(tool)}:${tool.category === "read" ? "read" : "write"}`),
        tool.name,
      ).toBe(true);
    }
  });

  it("detecta regressão de acesso do preset manager e do tools/list", () => {
    const profile = mcpPublicProfile(auth);
    expect(profile).toHaveLength(MCP_TOOL_COUNT);
    expect(profile.map((tool) => tool.name).sort()).toEqual(
      MCP_REGISTRY.map((tool) => tool.name).sort(),
    );
  });

  it("detecta organization_id público e entradas universais perigosas", () => {
    const forbidden = new Set([
      "organization_id",
      "organizationId",
      "sql",
      "raw_sql",
      "api_key",
      "access_token",
      "refresh_token",
    ]);
    for (const tool of MCP_REGISTRY) {
      for (const key of Object.keys(tool.inputSchema))
        expect(forbidden.has(key), `${tool.name}:${key}`).toBe(false);
    }
  });

  it("detecta regressão da última cerca contra vazamento de secrets", () => {
    const payload = sanitizeMcpPayload({
      nested: {
        api_key: "key-real",
        access_token: "access-real",
        refresh_token: "refresh-real",
        client_secret: "client-real",
        private_key: "private-real",
        authorization: "Bearer dsk_real",
      },
      error: "Bearer dsk_supersecreto api_key=valor-real",
    });
    const serialized = JSON.stringify(payload);
    for (const secret of [
      "key-real",
      "access-real",
      "refresh-real",
      "client-real",
      "private-real",
      "dsk_supersecreto",
      "valor-real",
    ])
      expect(serialized).not.toContain(secret);
  });

  it("detecta services canônicos renomeados sem atualização do MCP", () => {
    const sentinels: Array<[string, string[]]> = [
      ["lib/mcp/tools/messages.ts", ["sendMessageHandler", "comIdempotencia"]],
      ["lib/mcp/tools/leads.ts", ["moverLeadParaOutroFunil", "moveLeadHandler"]],
      [
        "lib/mcp/tools/agendamento.ts",
        ["marcarAgendamentoHandler", "alterarAgendamentoHandler", "cancelarAgendamentoHandler"],
      ],
      [
        "lib/mcp/tools/followup-administracao.ts",
        [
          "validateFlowForPublish",
          "publishFollowupFlowVersion",
          "pausaEnrollment",
          "retomaEnrollment",
        ],
      ],
      [
        "lib/mcp/tools/automacoes-roteamento.ts",
        ["loadEligibleAttendants", "decideRouting", "fn_set_channel_routing"],
      ],
      [
        "lib/mcp/tools/knowledge-administracao.ts",
        ["fn_replace_knowledge_faq_items", "knowledge_source.updated"],
      ],
      ["lib/mcp/tools/equipe-administracao.ts", ["emitirConvite", "reenviarConvite"]],
    ];
    for (const [file, symbols] of sentinels) {
      const source = read(file);
      for (const symbol of symbols) expect(source, `${file}:${symbol}`).toContain(symbol);
    }
  });
});
