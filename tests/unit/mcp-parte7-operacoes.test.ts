import { describe, expect, it } from "vitest";

import { MCP_REGISTRY, MCP_TOOL_COUNT } from "@/lib/mcp/registry";
import { crmGetKnowledgeUploadInstructions } from "@/lib/mcp/tools/knowledge-administracao";
import {
  crmGetContactImportInstructions,
  crmGetConversationMediaUploadInstructions,
  crmGetOperationalDiagnostics,
  crmGetPrivacyExportStatus,
  crmPrepareAuditExport,
  crmPrepareLeadBulkAction,
  crmPrepareMcpTokenManagement,
  crmPreviewLeadBulkAction,
  PARTE7_OPERATION_TOOLS,
} from "@/lib/mcp/tools/parte7-operacoes";
import { crmPrepareIntegrationAction } from "@/lib/mcp/tools/webhooks-integracoes-canais";

const ORG = "00000000-0000-4000-8000-000000000001";
const ID = "00000000-0000-4000-8000-000000000002";

function chain(result: Record<string, unknown>, calls: Array<[string, unknown[]]> = []) {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "not", "neq", "order", "limit"]) {
    q[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return q;
    };
  }
  q.maybeSingle = async () => result;
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return q;
}

function assertHumanAction(value: unknown) {
  expect(value).toMatchObject({
    human_action_required: true,
    code: expect.any(String),
    reason: expect.any(String),
    resource: { type: expect.any(String) },
    instruction: expect.any(String),
  });
}

describe("MCP Parte 7 — uploads, importações, exportações e bulk", () => {
  it("adiciona somente as 12 operações auditadas e mantém registry único", () => {
    expect(PARTE7_OPERATION_TOOLS).toHaveLength(12);
    expect(MCP_TOOL_COUNT).toBe(MCP_REGISTRY.length);
    expect(new Set(MCP_REGISTRY.map((tool) => tool.name)).size).toBe(MCP_REGISTRY.length);
    for (const tool of PARTE7_OPERATION_TOOLS) {
      expect(
        MCP_REGISTRY.some((registered) => registered.name === tool.name),
        tool.name,
      ).toBe(true);
      expect(tool.domain, tool.name).toBeTruthy();
      expect(Object.keys(tool.inputSchema), tool.name).not.toContain("organization_id");
    }
  });

  it("padroniza ações humanas existentes e novas sem transportar binário", async () => {
    const actions = [
      await crmGetKnowledgeUploadInstructions.handler({}, {} as never),
      await crmGetContactImportInstructions.handler({}, {} as never),
      await crmPrepareAuditExport.handler({}, {} as never),
      await crmPrepareIntegrationAction.handler(
        { provider: "nuvemshop", action: "connect" },
        {} as never,
      ),
    ];
    for (const action of actions) assertHumanAction(action);
    expect(actions[0]).toMatchObject({ upload_required: true, max_bytes: 20 * 1024 * 1024 });
    expect(JSON.stringify(actions)).not.toMatch(/authorization|credential_value|client_secret/i);
  });

  it("descreve a importação real sem prometer preview, job ou retry idempotente", async () => {
    const result = await crmGetContactImportInstructions.handler({}, {} as never);
    expect(result).toMatchObject({
      endpoint: "/api/v1/contacts/import",
      method: "POST",
      content_type: "multipart/form-data",
      max_rows: 500,
      asynchronous: false,
      preview_available: false,
      status_endpoint: null,
    });
  });

  it("valida ownership da conversa antes de instruir upload de mídia", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const ctx = {
      organizationId: ORG,
      supabase: { from: () => chain({ data: null, error: null }, calls) },
    } as never;
    await expect(
      crmGetConversationMediaUploadInstructions.handler({ conversation_id: ID }, ctx),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(calls).toContainEqual(["eq", ["organization_id", ORG]]);
    expect(calls).toContainEqual(["eq", ["id", ID]]);
  });

  it("faz preview de bulk tenant-scoped sem executar efeitos", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const supabase = {
      from: (table: string) => {
        expect(table).toBe("crm_leads");
        return chain(
          {
            data: [
              {
                id: ID,
                title: "Oportunidade",
                status: "open",
                stage_id: ID,
                pipeline_id: ID,
                owner_user_id: null,
                tags: [],
              },
            ],
            error: null,
          },
          calls,
        );
      },
    };
    const result = await crmPreviewLeadBulkAction.handler(
      {
        action: "tag",
        lead_ids: [ID],
        add_tags: ["prioridade"],
        remove_tags: [],
      },
      { organizationId: ORG, supabase } as never,
    );
    expect(result).toMatchObject({
      preview: true,
      side_effects_executed: false,
      affected_count: 1,
    });
    expect(calls).toContainEqual(["eq", ["organization_id", ORG]]);
  });

  it("mantém execução bulk no fluxo humano e sinaliza destruição", async () => {
    const supabase = {
      from: () => chain({ data: [{ id: ID, title: "X", tags: [] }], error: null }),
    };
    const result = await crmPrepareLeadBulkAction.handler(
      { action: "delete", lead_ids: [ID], add_tags: [], remove_tags: [] },
      { organizationId: ORG, supabase } as never,
    );
    assertHumanAction(result);
    expect(result).toMatchObject({
      reason: "destructive_bulk_requires_human_confirmation",
      required_capability: "destructive_operations",
      destructive: true,
      side_effects_executed: false,
    });
  });

  it("consulta exportação LGPD sem vazar path, URL ou destinatário", async () => {
    const privateResult = {
      pdf_path: `${ORG}/${ID}/report.pdf`,
      json_path: `${ORG}/${ID}/data.json`,
      signed_url: "https://private.invalid/token",
      delivered_to_hash: "hash",
      sha256: "digest",
      signed_pades: true,
    };
    const supabase = {
      from: () =>
        chain({
          data: {
            id: ID,
            request_type: "data_request",
            status: "completed",
            result: privateResult,
          },
          error: null,
        }),
    };
    const result = await crmGetPrivacyExportStatus.handler({ request_id: ID }, {
      organizationId: ORG,
      supabase,
    } as never);
    const serialized = JSON.stringify(result);
    expect(result).toMatchObject({
      result: { sha256: "digest", signed_pades: true, delivered: true },
    });
    expect(serialized).not.toContain("report.pdf");
    expect(serialized).not.toContain("private.invalid");
    expect(serialized).not.toContain("delivered_to_hash");
  });

  it("não permite autoelevação nem devolve plaintext de token", async () => {
    const result = await crmPrepareMcpTokenManagement.handler({}, { apiTokenId: ID } as never);
    assertHumanAction(result);
    expect(result).toMatchObject({
      reason: "self_escalation_is_forbidden",
      list_returns_plaintext: false,
      create_returns_plaintext_once: true,
      current_token_can_self_escalate: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/dsk_[a-z0-9_-]+/i);
  });

  it("diagnóstico é somente leitura, limitado e sem infraestrutura", () => {
    expect(crmGetOperationalDiagnostics.category).toBe("read");
    expect(crmGetOperationalDiagnostics.inputSchema).toEqual({});
    expect(crmGetOperationalDiagnostics.description).toContain("sem revelar segredos");
  });
});
