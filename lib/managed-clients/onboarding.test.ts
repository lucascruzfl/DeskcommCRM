import { describe, expect, it, vi } from "vitest";
import { MANAGED_CLIENT_PRESETS } from "./presets";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createManagedOnboardingService,
  managedOnboardingSchema,
  type ManagedOnboardingActor,
} from "./onboarding";

const actorId = "00000000-0000-4000-8000-000000000001";
const sourceOrg = "00000000-0000-4000-8000-000000000002";
const targetOrg = "00000000-0000-4000-8000-000000000003";
const inviteId = "00000000-0000-4000-8000-000000000004";
const clinicInput = {
  organization_name: "Clínica A",
  preset: "managed/aesthetic-clinic" as const,
  client_email: "cliente-a@fixture.test",
};
const actor: ManagedOnboardingActor = {
  userId: actorId,
  sourceOrganizationId: sourceOrg,
  apiTokenId: "fixture-token",
  requestId: "fixture-request",
};

type State = "organization_created" | "inviting" | "failed" | "completed";
function fixture(
  opts: {
    platformScope?: string | null;
    sourceRole?: string | null;
    mailConfigured?: boolean;
    failFirstEmail?: boolean;
    mfaRequired?: boolean;
    revoked?: boolean;
    accepted?: boolean;
    beginError?: { code: string; message: string };
  } = {},
) {
  const state = {
    platformScope: opts.platformScope === undefined ? "full" : opts.platformScope,
    sourceRole: opts.sourceRole === undefined ? "admin" : opts.sourceRole,
    organizations: 0,
    policies: 0,
    memberships: 0,
    invites: 0,
    receipt: null as null | {
      organization_id: string;
      actor_user_id: string;
      idempotency_key: string;
      request_hash: string;
      invite_id: string;
      state: State;
      email_dispatched: boolean;
      claim_id?: string;
    },
  };
  const rpcCalls: string[] = [];
  const policies: unknown[] = [];
  const auditCalls: Array<{ action: string }> = [];
  const emailCalls: string[] = [];
  const db = {
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              email: "gestor-agencia@fixture.test",
            },
          },
          error: null,
        }),
      },
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let change: Record<string, unknown> | null = null;
      const run = async () => {
        if (change) {
          if (table === "managed_client_onboardings" && state.receipt) {
            Object.assign(state.receipt, change);
            return { data: { organization_id: targetOrg }, error: null };
          }
          if (table === "team_invites") return { data: { id: inviteId }, error: null };
          return { data: null, error: null };
        }
        if (table === "platform_admins")
          return {
            data:
              state.platformScope && !opts.revoked
                ? { scope: state.platformScope, mfa_required: !!opts.mfaRequired }
                : null,
            error: null,
          };
        if (table === "user_organizations")
          return {
            data: state.sourceRole && opts.accepted !== false ? { role: state.sourceRole } : null,
            error: null,
          };
        if (table === "managed_client_onboardings") return { data: state.receipt, error: null };
        if (table === "organizations")
          return {
            data: state.organizations && filters.slug ? { id: targetOrg } : null,
            error: null,
          };
        throw new Error(`unexpected table: ${table}`);
      };
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        is: () => chain,
        not: () => chain,
        update: (values: Record<string, unknown>) => {
          change = values;
          return chain;
        },
        maybeSingle: run,
        then: (resolve: (value: Awaited<ReturnType<typeof run>>) => unknown) => run().then(resolve),
      };
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push(name);
      if (name === "fn_begin_managed_client_onboarding") {
        if (opts.beginError) return { data: null, error: opts.beginError };
        policies.push(args.p_policy);
        if (!state.receipt) {
          state.organizations++;
          state.policies++;
          state.memberships++;
          state.invites++;
          state.receipt = {
            organization_id: targetOrg,
            actor_user_id: actorId,
            idempotency_key: String(args.p_key),
            request_hash: String(args.p_hash),
            invite_id: inviteId,
            state: "organization_created",
            email_dispatched: false,
          };
          return {
            data: { organization_id: targetOrg, invite_id: inviteId, created: true },
            error: null,
          };
        }
        return {
          data: { organization_id: targetOrg, invite_id: inviteId, created: false },
          error: null,
        };
      }
      if (name === "fn_claim_managed_client_invite") {
        if (!state.receipt) throw new Error("receipt missing");
        if (state.receipt.state === "completed")
          return { data: { claimed: false, state: "completed" }, error: null };
        state.receipt.state = "inviting";
        state.receipt.claim_id = String(args.p_claim);
        return { data: { claimed: true, state: "inviting" }, error: null };
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
  } as unknown as SupabaseClient;
  const issueInvite = vi.fn(async () => {
    emailCalls.push("send");
    return {
      invite_id: inviteId,
      email: clinicInput.client_email,
      expires_at: new Date().toISOString(),
      email_dispatched: !(opts.failFirstEmail && emailCalls.length === 1),
      accept_url: "https://fixture.test/secret-invite-token",
      email_error:
        opts.failFirstEmail && emailCalls.length === 1 ? ("send_failed" as const) : undefined,
    };
  });
  const service = createManagedOnboardingService({
    admin: () => db,
    emailConfigured: async () => opts.mailConfigured !== false,
    issueInvite,
    audit: async (entry) => {
      auditCalls.push(entry);
    },
  });
  return { service, state, policies, rpcCalls, auditCalls, emailCalls, issueInvite };
}

describe.each(Object.values(MANAGED_CLIENT_PRESETS))("onboarding $id", (preset) => {
  const input = { ...clinicInput, preset: preset.id };
  it("platform_admin full vê can_execute, mas preflight e confirm=false não executam", async () => {
    const f = fixture();
    const plan = await f.service.preflight(input, actor);
    expect(plan.can_execute).toBe(true);
    expect(plan.preset).toEqual({ id: preset.id, version: preset.version, label: preset.label });
    expect(JSON.stringify(plan)).not.toContain("_internal");
    expect(
      [
        ...plan.client_areas,
        ...plan.agency_areas,
        ...plan.shared_areas,
        ...plan.not_applicable_areas,
      ]
        .map((area) => [area.href, area.classification])
        .sort(),
    ).toEqual(Object.entries(preset.areas).sort());
    expect(await f.service.execute(input, actor, false)).toMatchObject({
      requires_confirmation: true,
    });
    expect(f.rpcCalls).toEqual([]);
    expect(f.state.organizations).toBe(0);
  });

  it.each([
    [null, "admin"],
    [null, "manager"],
    [null, "agent"],
    ["full", "agent"],
    ["support_readonly", "admin"],
  ])("recusa platform scope=%s e membership=%s", async (scope, role) => {
    const f = fixture({ platformScope: scope, sourceRole: role });
    expect((await f.service.preflight(input, actor)).can_execute).toBe(false);
    await expect(f.service.execute(input, actor, true)).rejects.toThrow(
      "managed_onboarding_denied",
    );
    expect(f.rpcCalls).toEqual([]);
  });

  it("recusa preset e e-mail inválidos antes de acessar o banco", async () => {
    const f = fixture();
    await expect(
      f.service.preflight({ ...input, preset: "managed/other" as never }, actor),
    ).rejects.toThrow();
    await expect(
      f.service.preflight({ ...input, client_email: "invalid" }, actor),
    ).rejects.toThrow();
    expect(f.rpcCalls).toEqual([]);
  });

  it("bloqueia slug já ocupado e transporte de convite indisponível", async () => {
    const duplicated = fixture();
    duplicated.state.organizations = 1;
    const duplicatePlan = await duplicated.service.preflight(input, actor);
    expect(duplicatePlan.can_execute).toBe(false);
    expect(duplicatePlan.conflicts).toContain("organization_slug_exists");
    await expect(duplicated.service.execute(input, actor, true)).rejects.toThrow(
      "managed_onboarding_denied",
    );
    expect(duplicated.rpcCalls).toEqual([]);

    const noMail = fixture({ mailConfigured: false });
    const noMailPlan = await noMail.service.preflight(input, actor);
    expect(noMailPlan.can_execute).toBe(false);
    expect(noMailPlan.warnings).toContain("email_delivery_not_configured");
  });

  it("cria uma vez, audita estados e nunca devolve o link secreto", async () => {
    const f = fixture();
    const first = await f.service.execute(input, actor, true);
    const second = await f.service.execute(input, actor, true);
    expect(first).toMatchObject({
      status: "completed",
      organization_id: targetOrg,
      client_role: "agent",
      agency_role: "admin",
      email_dispatched: true,
    });
    expect(second).toMatchObject({ status: "already_completed", organization_id: targetOrg });
    expect(f.state.organizations).toBe(1);
    expect(f.state.policies).toBe(1);
    expect(f.policies[0]).toMatchObject({
      preset_id: preset.id,
      business_type: preset.business_type,
      areas: preset.areas,
    });
    expect(f.state.memberships).toBe(1);
    expect(f.state.invites).toBe(1);
    expect(f.emailCalls).toHaveLength(1);
    expect(f.auditCalls.map((entry) => entry.action)).toEqual([
      "managed_client.onboarding_started",
      "managed_client.onboarding_completed",
    ]);
    expect(JSON.stringify({ first, second, audit: f.auditCalls })).not.toContain(
      "secret-invite-token",
    );
  });

  it("retoma após falha do e-mail sem segundo tenant, membership, policy ou convite", async () => {
    const f = fixture({ failFirstEmail: true });
    expect(await f.service.execute(input, actor, true)).toMatchObject({
      status: "failed",
      retryable: true,
    });
    expect(await f.service.execute(input, actor, true)).toMatchObject({ status: "completed" });
    expect([f.state.organizations, f.state.policies, f.state.memberships, f.state.invites]).toEqual(
      [1, 1, 1, 1],
    );
    expect(f.emailCalls).toHaveLength(2);
    expect(f.auditCalls.map((entry) => entry.action)).toEqual([
      "managed_client.onboarding_started",
      "managed_client.onboarding_failed",
      "managed_client.onboarding_completed",
    ]);
  });
  it.each([{ revoked: true }, { mfaRequired: true }, { accepted: false }])(
    "revalida admin ativo, MFA e membership aceito: %j",
    async (options) => {
      const f = fixture(options);
      expect((await f.service.preflight(input, actor)).can_execute).toBe(false);
      await expect(f.service.execute(input, actor, true)).rejects.toThrow(
        "managed_onboarding_denied",
      );
      expect(f.rpcCalls).toEqual([]);
    },
  );

  it("sem identidade do provisionador não cria via sessão/impersonation ou agente IA", async () => {
    const f = fixture();
    const anonymous = { ...actor, userId: null };
    expect((await f.service.preflight(input, anonymous)).conflicts).toContain(
      "authenticated_actor_required",
    );
    await expect(f.service.execute(input, anonymous, true)).rejects.toThrow(
      "managed_onboarding_denied",
    );
    expect(f.rpcCalls).toEqual([]);
  });

  it("erro SQL/credencial do banco não sai no resultado", async () => {
    const f = fixture({
      beginError: { code: "XX000", message: "SQL postgres://secret-password internal_table" },
    });
    await expect(f.service.execute(input, actor, true)).rejects.toThrow(
      /^managed_onboarding_unavailable$/,
    );
    expect(f.emailCalls).toEqual([]);
  });
});

describe("identidade do preset no contrato", () => {
  it("schema aceita somente chaves registradas", () => {
    for (const preset of Object.values(MANAGED_CLIENT_PRESETS)) {
      expect(managedOnboardingSchema.parse({ ...clinicInput, preset: preset.id }).preset).toBe(
        preset.id,
      );
    }
    for (const preset of ["managed/unknown", "toString", "__proto__"]) {
      expect(managedOnboardingSchema.safeParse({ ...clinicInput, preset }).success).toBe(false);
    }
  });

  it("trocar preset altera hash e chave automática; reutilizar chave explícita conflita", async () => {
    const f = fixture();
    const clinic = await f.service.preflight(clinicInput, actor);
    const ispInput = { ...clinicInput, preset: "managed/internet-provider" as const };
    const isp = await f.service.preflight(ispInput, actor);
    expect(isp.plan_id).not.toBe(clinic.plan_id);
    expect(isp.idempotency_key).not.toBe(clinic.idempotency_key);
    await f.service.execute(clinicInput, actor, true);
    const conflicting = { ...ispInput, idempotency_key: clinic.idempotency_key };
    expect((await f.service.preflight(conflicting, actor)).conflicts).toContain(
      "idempotency_key_conflict",
    );
    await expect(f.service.execute(conflicting, actor, true)).rejects.toThrow(
      "managed_onboarding_denied",
    );
    expect(f.state.organizations).toBe(1);
  });
});
