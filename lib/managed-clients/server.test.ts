import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildManagedAreaPolicy } from "./policy";

const state = vi.hoisted(() => ({
  policy: null as unknown,
  role: "agent" as string | null,
  policyError: false,
  memberError: false,
  filters: [] as string[],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { state.filters.push(`${table}.eq.${column}.${value}`); return query; },
        is: (column: string, value: unknown) => { state.filters.push(`${table}.is.${column}.${value}`); return query; },
        not: (column: string, operator: string, value: unknown) => { state.filters.push(`${table}.not.${column}.${operator}.${value}`); return query; },
        maybeSingle: async () => table === "managed_client_policies"
          ? { data: state.policy, error: state.policyError ? { message: "db_error" } : null }
          : { data: state.role ? { role: state.role } : null, error: state.memberError ? { message: "db_error" } : null },
      };
      return query;
    },
  }),
}));

import { managedAreaAllowedForActor } from "./server";

describe("gate de área em server action com service_role", () => {
  beforeEach(() => {
    state.policy = buildManagedAreaPolicy("managed/aesthetic-clinic");
    state.role = "agent";
    state.policyError = false;
    state.memberError = false;
    state.filters = [];
  });

  it("nega ao cliente uma área da agência e uma não aplicável", async () => {
    expect(await managedAreaAllowedForActor("org", "agent", "/app/ai/agents")).toBe(false);
    expect(await managedAreaAllowedForActor("org", "agent", "/app/integrations/nuvemshop")).toBe(false);
  });

  it("permite ao gestor com membership aceito a área da agência", async () => {
    state.role = "admin";
    expect(await managedAreaAllowedForActor("org", "manager", "/app/ai/agents")).toBe(true);
    expect(state.filters).toContain("user_organizations.eq.organization_id.org");
    expect(state.filters).toContain("user_organizations.eq.user_id.manager");
    expect(state.filters).toContain("user_organizations.is.revoked_at.null");
    expect(state.filters).toContain("user_organizations.not.accepted_at.is.null");
    expect(await managedAreaAllowedForActor("org", "manager", "/app/integrations/nuvemshop")).toBe(false);
  });

  it("a mesma linha de política aplica um override", async () => {
    state.policy = buildManagedAreaPolicy("managed/aesthetic-clinic", [
      { href: "/app/campaigns", classification: "client" },
    ]);
    expect(await managedAreaAllowedForActor("org", "agent", "/app/campaigns")).toBe(true);
  });

  it("falha fechado sem ator, membership ou política disponível", async () => {
    expect(await managedAreaAllowedForActor("org", null, "/app/inbox")).toBe(false);
    state.role = null;
    expect(await managedAreaAllowedForActor("org", "agent", "/app/inbox")).toBe(false);
    state.policyError = true;
    expect(await managedAreaAllowedForActor("org", "agent", "/app/inbox")).toBe(false);
  });

  it("não atribui preset aos tenants antigos", async () => {
    state.policy = null;
    expect(await managedAreaAllowedForActor("legacy", "actor", "/app/integrations/nuvemshop")).toBe(true);
  });
});
