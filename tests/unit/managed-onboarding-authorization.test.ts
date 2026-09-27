import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";

const fixture = vi.hoisted(() => ({
  actorId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "agent",
  accepted: true,
  revoked: false,
  policy: null as ReturnType<typeof buildManagedAreaPolicy> | null,
  tables: [] as string[],
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => ({
    id: fixture.actorId,
    full_name: "Fixture",
    email: "fixture@test.invalid",
  }),
  // Snapshot desatualizado não pode conceder o admin que o banco já revogou.
  resolveActiveOrg: async () => ({ orgId: fixture.orgId, name: "Fixture", role: "admin" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      fixture.tables.push(table);
      if (!["managed_client_policies", "user_organizations"].includes(table)) {
        throw new Error(`privileged effect reached: ${table}`);
      }
      const filters: Record<string, unknown> = {};
      let acceptedRequired = false;
      let revokedExcluded = false;
      const q = {
        select: () => q,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return q;
        },
        is: (column: string) => {
          revokedExcluded = column === "revoked_at";
          return q;
        },
        not: (column: string) => {
          acceptedRequired = column === "accepted_at";
          return q;
        },
        maybeSingle: async () => ({
          data:
            filters.organization_id !== fixture.orgId
              ? null
              : table === "managed_client_policies"
                ? fixture.policy
                : filters.user_id === fixture.actorId &&
                    acceptedRequired &&
                    revokedExcluded &&
                    fixture.accepted &&
                    !fixture.revoked
                  ? { role: fixture.role }
                  : null,
          error: null,
        }),
      };
      return q;
    },
  }),
}));

import { requireOnboardingCtx } from "@/app/actions/onboarding/_shared";
import { dadosDoPasso } from "@/app/actions/onboarding/montarQuadro";

beforeEach(() => {
  fixture.policy = buildManagedAreaPolicy("managed/aesthetic-clinic");
  fixture.role = "agent";
  fixture.accepted = true;
  fixture.revoked = false;
  fixture.tables = [];
});

describe("ações existentes de configuração não contornam o perfil gerenciado", () => {
  it("cliente não alcança convite, criação de agente ou escrita do quadro", async () => {
    await expect(requireOnboardingCtx()).rejects.toMatchObject({ code: "forbidden" });
    expect(fixture.tables).toEqual(["managed_client_policies", "user_organizations"]);
  });
  it.each(["pending", "revoked"])("membership %s não concede configuração", async (kind) => {
    fixture.role = "admin";
    fixture.accepted = kind !== "pending";
    fixture.revoked = kind === "revoked";
    await expect(requireOnboardingCtx()).rejects.toMatchObject({ code: "forbidden" });
  });
  it("gestor com membership oficial mantém a configuração", async () => {
    fixture.role = "admin";
    await expect(requireOnboardingCtx()).resolves.toMatchObject({ orgId: fixture.orgId });
  });
  it("leitura do quadro não aceita tenant alheio mesmo para gestor", async () => {
    fixture.role = "admin";
    await expect(
      dadosDoPasso("33333333-3333-4333-8333-333333333333", "Clínica"),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(fixture.tables).toEqual(["managed_client_policies", "user_organizations"]);
  });
  it("cliente não alcança a leitura administrativa do próprio quadro", async () => {
    await expect(dadosDoPasso(fixture.orgId, "Clínica")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
