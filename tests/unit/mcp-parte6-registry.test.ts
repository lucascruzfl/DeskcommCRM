import { describe, expect, it } from "vitest";

import { MCP_REGISTRY, MCP_TOOL_COUNT } from "@/lib/mcp/registry";
import { crmGetKnowledgeUploadInstructions } from "@/lib/mcp/tools/knowledge-administracao";
import { crmUpdateTeamMemberRole } from "@/lib/mcp/tools/equipe-administracao";
import {
  crmPrepareChannelAction,
  crmPrepareIntegrationAction,
  crmUpdateChannelAiAccess,
} from "@/lib/mcp/tools/webhooks-integracoes-canais";

const KNOWLEDGE = [
  "crm_get_knowledge_source",
  "crm_create_knowledge_source",
  "crm_update_knowledge_source",
  "crm_replace_knowledge_faq",
  "crm_reindex_knowledge_source",
  "crm_archive_knowledge_source",
  "crm_get_knowledge_upload_instructions",
] as const;
const TEMPLATES_COMMERCE = [
  "crm_get_message_template",
  "crm_create_message_template",
  "crm_update_message_template",
  "crm_duplicate_message_template",
  "crm_delete_message_template",
  "crm_list_external_message_templates",
  "crm_list_products",
  "crm_get_product",
  "crm_create_product",
  "crm_update_product",
  "crm_delete_product",
  "crm_list_orders",
  "crm_get_order",
] as const;
const WEBHOOKS_CHANNELS = [
  "crm_get_webhook_source",
  "crm_update_webhook_source",
  "crm_delete_webhook_source",
  "crm_discover_integrations",
  "crm_prepare_integration_action",
  "crm_get_channel_admin",
  "crm_update_channel_ai_access",
  "crm_prepare_channel_action",
] as const;
const TEAM = [
  "crm_get_team_member",
  "crm_list_team_invites",
  "crm_invite_team_member",
  "crm_resend_team_invite",
  "crm_revoke_team_invite",
  "crm_update_team_member_interface",
  "crm_update_team_member_role",
  "crm_revoke_team_member",
  "crm_reactivate_team_member",
] as const;
const PARTE_6 = [...KNOWLEDGE, ...TEMPLATES_COMMERCE, ...WEBHOOKS_CHANNELS, ...TEAM] as const;
const registry = new Map(MCP_REGISTRY.map((tool) => [tool.name, tool]));

describe("registry MCP da Parte 6", () => {
  it("preserva as 37 tools da Parte 6 no registry atual, sem duplicidade", () => {
    expect(PARTE_6).toHaveLength(37);
    expect(MCP_TOOL_COUNT).toBe(202);
    expect(new Set(MCP_REGISTRY.map((tool) => tool.name)).size).toBe(202);
    for (const name of PARTE_6) expect(registry.has(name), name).toBe(true);
  });

  it("não aceita organization_id nem credenciais como input público", () => {
    for (const name of PARTE_6) {
      const keys = Object.keys(registry.get(name)!.inputSchema);
      expect(keys, name).not.toContain("organization_id");
      for (const secret of [
        "token",
        "access_token",
        "refresh_token",
        "client_secret",
        "ciphertext",
        "api_key",
      ])
        expect(keys, `${name}:${secret}`).not.toContain(secret);
    }
  });

  it("toda escrita tem domínio e recurso auditável", () => {
    for (const name of PARTE_6) {
      const tool = registry.get(name)!;
      expect(tool.domain, name).toBeTruthy();
      if (tool.category === "write") expect(tool.auditResource, name).toBeTypeOf("function");
    }
  });

  it("protege exclusões e revogações com destructive_operations", () => {
    for (const name of [
      "crm_archive_knowledge_source",
      "crm_delete_message_template",
      "crm_delete_product",
      "crm_delete_webhook_source",
      "crm_revoke_team_invite",
      "crm_revoke_team_member",
    ])
      expect(registry.get(name)?.capabilities, name).toContain("destructive_operations");
  });

  it("papéis delegáveis não incluem admin ou owner", () => {
    for (const name of ["crm_invite_team_member", "crm_update_team_member_role"]) {
      const role = registry.get(name)!.inputSchema.role as unknown as {
        safeParse(value: unknown): { success: boolean };
      };
      expect(role.safeParse("manager").success).toBe(true);
      expect(role.safeParse("admin").success).toBe(false);
      expect(role.safeParse("owner").success).toBe(false);
    }
  });

  it("mutações administrativas de equipe exigem provisionador admin humano", async () => {
    await expect(
      crmUpdateTeamMemberRole.handler(
        {
          member_id: "00000000-0000-4000-8000-000000000001",
          role: "manager",
        },
        { provisionedByUserId: undefined } as never,
      ),
    ).rejects.toMatchObject({ code: "human_action_required" });
  });

  it("configuração administrativa do canal exige provisionador admin humano", async () => {
    await expect(
      crmUpdateChannelAiAccess.handler(
        {
          channel_id: "00000000-0000-4000-8000-000000000001",
          mode: "pre_go_live",
          test_phone_numbers: [],
        },
        { provisionedByUserId: undefined } as never,
      ),
    ).rejects.toMatchObject({ code: "human_action_required" });
  });

  it("upload binário orienta o endpoint oficial", async () => {
    const result = await crmGetKnowledgeUploadInstructions.handler({}, {} as never);
    expect(result).toMatchObject({
      human_action_required: true,
      endpoint: "/api/v1/ai/knowledge/sources/upload",
    });
  });

  it("OAuth não automatiza consentimento", async () => {
    const result = await crmPrepareIntegrationAction.handler(
      { provider: "nuvemshop", action: "connect" },
      {} as never,
    );
    expect(result).toMatchObject({
      human_action_required: true,
      reason: "oauth_consent_requires_human",
    });
  });

  it("provisionamento de canal permanece humano", async () => {
    const result = await crmPrepareChannelAction.handler({ action: "provision" }, {} as never);
    expect(result).toMatchObject({
      human_action_required: true,
      action: "provision",
      url: "/app/connections",
    });
  });

  it("preview existente continua somente leitura e sem capacidade de envio", () => {
    const preview = registry.get("crm_render_message_template")!;
    expect(preview.category).toBe("read");
    expect(preview.capabilities ?? []).not.toContain("send_messages");
  });

  it("pedidos novos são somente leitura porque o núcleo só sincroniza histórico", () => {
    expect(registry.get("crm_list_orders")?.category).toBe("read");
    expect(registry.get("crm_get_order")?.category).toBe("read");
    expect(PARTE_6.some((name) => name.includes("create_order"))).toBe(false);
  });
});
