import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preflight: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/managed-clients/onboarding", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return { ...original, managedOnboardingService: mocks };
});

import { MANAGED_CLIENT_TOOLS } from "./managed-clients";

const actor = {
  actor: { type: "api_token", id: "token-1", role: "manager" },
  provisionedByUserId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  apiTokenId: "token-1",
  requestId: "request-1",
} as Parameters<(typeof MANAGED_CLIENT_TOOLS)[number]["handler"]>[1];

describe("tools MCP de onboarding gerenciado", () => {
  it("preserva catálogo e redige PII e confirmação na auditoria", () => {
    expect(MANAGED_CLIENT_TOOLS.map((tool) => tool.name)).toEqual([
      "crm_list_managed_client_presets", "crm_preflight_managed_client", "crm_create_managed_client",
    ]);
    const create = MANAGED_CLIENT_TOOLS[2]!;
    expect(create.category).toBe("write");
    expect(create.requiresScope).toBe("mcp:write");
    expect(create.capabilities).toEqual(["managed_client_onboarding"]);
    expect(create.redigirParaAuditoria?.({
      organization_name: "Clínica Vip", client_email: "contato@clinicavip.com.br",
      preset: "managed/aesthetic-clinic", confirm: true,
    })).toEqual({ preset: "managed/aesthetic-clinic", confirm: true, idempotency_key_present: false });
  });

  it("preflight existente chama serviço sem mutação", async () => {
    mocks.preflight.mockResolvedValue({ can_execute: true, conflicts: [] });
    const result = await MANAGED_CLIENT_TOOLS[1]!.handler({
      business_type: "aesthetic_clinic", management_mode: "managed",
      name: "Clínica Vip", slug: "clinica-vip", client_email: "contato@clinicavip.com.br",
      overrides: [],
    }, actor);
    expect(result).toMatchObject({ can_execute: true, request_id: "request-1" });
    expect(mocks.preflight).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("confirm=false e confirm=true chegam separadamente ao serviço", async () => {
    mocks.execute.mockResolvedValue({ status: "preflight" });
    const tool = MANAGED_CLIENT_TOOLS[2]!;
    const base = { organization_name: "Clínica Vip", preset: "managed/aesthetic-clinic",
      client_email: "contato@clinicavip.com.br" };
    await tool.handler(base, actor);
    await tool.handler({ ...base, confirm: true }, actor);
    expect(mocks.execute.mock.calls[0]?.[2]).toBe(false);
    expect(mocks.execute.mock.calls[1]?.[2]).toBe(true);
    expect(mocks.execute.mock.calls[1]?.[0]).not.toHaveProperty("confirm");
  });
});
