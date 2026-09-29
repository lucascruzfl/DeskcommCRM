import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preflight: vi.fn(), execute: vi.fn(), ispExecute: vi.fn() }));
vi.mock("@/lib/managed-clients/onboarding", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return { ...original, managedOnboardingService: mocks };
});
vi.mock("@/lib/managed-clients/isp-package", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return { ...original, ispPackageService: { execute: mocks.ispExecute } };
});

import { z } from "zod";
import { MANAGED_CLIENT_PRESETS } from "@/lib/managed-clients/presets";
import { MANAGED_PRESET_IDS, MANAGED_BUSINESS_TYPES } from "@/lib/managed-clients/presets";
import { MANAGED_CLIENT_TOOLS } from "./managed-clients";

const actor = {
  actor: { type: "api_token", id: "token-1", role: "manager" },
  provisionedByUserId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  apiTokenId: "token-1",
  requestId: "request-1",
} as Parameters<(typeof MANAGED_CLIENT_TOOLS)[number]["handler"]>[1];

describe("tools MCP de onboarding gerenciado", () => {
  beforeEach(() => vi.clearAllMocks());
  it("preserva catálogo e redige PII e confirmação na auditoria", () => {
    expect(MANAGED_CLIENT_TOOLS.map((tool) => tool.name)).toEqual([
      "crm_list_managed_client_presets",
      "crm_preflight_managed_client",
      "crm_create_managed_client",
      "crm_configure_managed_internet_provider",
    ]);
    const create = MANAGED_CLIENT_TOOLS[2]!;
    expect(create.category).toBe("write");
    expect(create.requiresScope).toBe("mcp:write");
    expect(create.capabilities).toEqual(["managed_client_onboarding"]);
    expect(
      create.redigirParaAuditoria?.({
        organization_name: "Clínica Vip",
        client_email: "contato@clinicavip.com.br",
        preset: "managed/aesthetic-clinic",
        confirm: true,
      }),
    ).toEqual({
      preset: "managed/aesthetic-clinic",
      confirm: true,
      idempotency_key_present: false,
    });
  });
  it("pacote ISP exige organização explícita e passa confirmação separada ao serviço", async () => {
    const tool = MANAGED_CLIENT_TOOLS[3]!;
    const target = "00000000-0000-4000-8000-000000000010";
    mocks.ispExecute.mockResolvedValue({ can_execute: true });
    await tool.handler({ organization_id: target }, actor);
    await tool.handler({ organization_id: target, confirm: true }, actor);
    expect(mocks.ispExecute.mock.calls).toEqual([
      [target, expect.objectContaining({ userId: actor.provisionedByUserId }), false],
      [target, expect.objectContaining({ userId: actor.provisionedByUserId }), true],
    ]);
    expect(tool.redigirParaAuditoria?.({ organization_id: target, confirm: true })).toEqual({ organization_id: target, confirm: true });
    await expect(tool.handler({ organization_id: "not-an-id", confirm: true }, actor)).rejects.toThrow();
  });

  it.each(Object.values(MANAGED_CLIENT_PRESETS))(
    "preflight $id chama o preset correto sem mutação",
    async (preset) => {
      mocks.preflight.mockResolvedValue({ can_execute: true, conflicts: [] });
      const result = await MANAGED_CLIENT_TOOLS[1]!.handler(
        {
          business_type: preset.business_type,
          management_mode: "managed",
          name: "Clínica Vip",
          slug: "clinica-vip",
          client_email: "contato@clinicavip.com.br",
          overrides: [],
        },
        actor,
      );
      expect(result).toMatchObject({ can_execute: true, request_id: "request-1" });
      expect(mocks.preflight).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ preset: preset.id }),
        expect.objectContaining({
          userId: actor.provisionedByUserId,
          sourceOrganizationId: actor.organizationId,
        }),
      );
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it.each(Object.values(MANAGED_CLIENT_PRESETS))(
    "confirmação $id chega separadamente ao serviço",
    async (preset) => {
      mocks.execute.mockResolvedValue({ status: "preflight" });
      const tool = MANAGED_CLIENT_TOOLS[2]!;
      const base = {
        organization_name: "Clínica Vip",
        preset: preset.id,
        client_email: "contato@clinicavip.com.br",
      };
      await tool.handler(base, actor);
      await tool.handler({ ...base, confirm: true }, actor);
      expect(mocks.execute.mock.calls[0]?.[2]).toBe(false);
      expect(mocks.execute.mock.calls[1]?.[2]).toBe(true);
      expect(mocks.execute.mock.calls[1]?.[0]).not.toHaveProperty("confirm");
    },
  );
  it("schemas públicos MCP/API anunciam exatamente o registro", async () => {
    const create = z.toJSONSchema(z.object(MANAGED_CLIENT_TOOLS[2]!.inputSchema), { io: "input" });
    const preflight = z.toJSONSchema(z.object(MANAGED_CLIENT_TOOLS[1]!.inputSchema), {
      io: "input",
    });
    expect(create.properties?.preset).toMatchObject({ enum: MANAGED_PRESET_IDS });
    expect(preflight.properties?.business_type).toMatchObject({ enum: MANAGED_BUSINESS_TYPES });
    const result = await MANAGED_CLIENT_TOOLS[0]!.handler({}, actor);
    expect(result).toEqual(
      Object.values(MANAGED_CLIENT_PRESETS).map((preset) =>
        expect.objectContaining({
          id: preset.id,
          business_type: preset.business_type,
          areas: expect.any(Array),
        }),
      ),
    );
  });

  it("presets e tipos desconhecidos não alcançam o serviço", async () => {
    await expect(
      MANAGED_CLIENT_TOOLS[2]!.handler(
        {
          organization_name: "Cliente",
          preset: "managed/unknown",
          client_email: "fixture@test.invalid",
        },
        actor,
      ),
    ).rejects.toThrow();
    await expect(
      MANAGED_CLIENT_TOOLS[1]!.handler(
        {
          name: "Cliente",
          slug: "cliente",
          business_type: "unknown",
          management_mode: "managed",
          client_email: "fixture@test.invalid",
        },
        actor,
      ),
    ).rejects.toThrow();
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(["user", "ai_agent"])("ator %s não recebe identidade de provisionador", async (type) => {
    mocks.execute.mockResolvedValue({ can_execute: false });
    await MANAGED_CLIENT_TOOLS[2]!.handler(
      {
        organization_name: "Provedor",
        preset: "managed/internet-provider",
        client_email: "fixture@test.invalid",
        confirm: true,
      },
      { ...actor, actor: { ...actor.actor, type } } as typeof actor,
    );
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: null }),
      true,
    );
  });
});
