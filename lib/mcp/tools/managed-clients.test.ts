import { describe, expect, it } from "vitest";
import { MANAGED_CLIENT_TOOLS } from "./managed-clients";

describe("tools MCP de planejamento gerenciado", () => {
  it("expõe só leitura e não grava PII nos argumentos auditados", async () => {
    expect(MANAGED_CLIENT_TOOLS.map((tool) => tool.name)).toEqual([
      "crm_list_managed_client_presets",
      "crm_preflight_managed_client",
    ]);
    expect(MANAGED_CLIENT_TOOLS.every((tool) => tool.category === "read" && tool.requiresScope === "mcp:read"))
      .toBe(true);

    const tool = MANAGED_CLIENT_TOOLS[1]!;
    const args = {
      business_type: "aesthetic_clinic",
      management_mode: "managed",
      name: "Clínica Vip",
      slug: "clinica-vip",
      client_email: "contato@clinicavip.com.br",
      overrides: [],
    };
    expect(tool.redigirParaAuditoria?.(args)).toEqual({
      business_type: "aesthetic_clinic",
      management_mode: "managed",
      override_count: 0,
    });

    const result = await tool.handler(args, {
      provisionedByUserId: "provisioner",
      requestId: "request-1",
    } as Parameters<typeof tool.handler>[1]);
    expect(result).toMatchObject({
      can_execute: false,
      request_id: "request-1",
      agency_manager: { proposed_user_id: "provisioner", source: "token_provisioner_unverified" },
      conflicts: expect.arrayContaining(["managed_backend_authorization_incomplete"]),
    });
  });
});
