import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { managedFixture } from "./helpers/managed-client-fixture";
import { MANAGED_CLIENT_PRESETS } from "../../lib/managed-clients/presets";

let fixture: Awaited<ReturnType<typeof managedFixture>>;
test.describe.configure({ timeout: 300_000 });
test.beforeAll(async () => {
  fixture = await managedFixture();
});
test.afterAll(async () => {
  if (fixture) await fixture.cleanup();
});

async function login(page: Page, role: string) {
  await page.goto("/login");
  await page.locator("#email").fill(fixture.users[role]!.email);
  await page.locator("#password").fill(fixture.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app\//, { timeout: 120_000 });
}
async function evidence(page: Page, name: string) {
  const shot = await page.screenshot({ fullPage: true });
  await test.info().attach(name, { body: shot, contentType: "image/png" });
}
const forbiddenAreas = Object.entries(MANAGED_CLIENT_PRESETS["managed/aesthetic-clinic"].areas)
  .filter(([, kind]) => kind === "agency" || kind === "not_applicable")
  .map(([href]) => href);

test("cliente agent entra, usa Inbox/Contatos/Agenda/Funil e move lead sem administração", async ({
  page,
}) => {
  await login(page, "clientA");
  await page.goto(`/app/inbox?id=${fixture.clinics.A!.conversation}`);
  await expect(page.getByText("Paciente A Fase 5").first()).toBeVisible({ timeout: 90_000 });
  for (const href of forbiddenAreas) await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0);
  await expect(page.getByTestId("tenant-switcher")).toHaveCount(0);
  const conversations = await page.request.get(
    `/api/v1/conversations/${fixture.clinics.A!.conversation}`,
  );
  expect(conversations.status()).toBe(200);
  expect(await conversations.text()).not.toContain("never-expose");
  const history = await page.request.get(
    `/api/v1/conversations/${fixture.clinics.A!.conversation}/messages`,
  );
  expect(history.status()).toBe(200);
  expect(await history.text()).not.toContain("never-expose");
  await page.getByRole("textbox", { name: "Adicionar tag à conversa" }).fill("fase5");
  await page.getByRole("button", { name: "Adicionar tag", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remover tag fase5" })).toBeVisible();
  expect((await page.request.get("/api/v1/tags/cores")).status()).toBe(200);
  await evidence(page, "cliente-inbox");
  await page.goto("/app/contacts");
  await expect(page.getByText("Paciente A Fase 5").first()).toBeVisible({ timeout: 90_000 });
  await evidence(page, "cliente-contatos");
  const c = fixture.clinics.A!;
  await page.goto(`/app/pipelines/${c.pipeline}`);
  const card = page.getByRole("group", { name: "Lead: Avaliação A Fase 5" });
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('a[href="/app/settings/tenant/pipelines"]')).toHaveCount(0);
  const moved = page.waitForResponse(
    (r) => r.url().includes(`/api/v1/leads/${c.lead}/move`) && r.request().method() === "POST",
  );
  await card.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  await page.keyboard.press("Space");
  expect((await moved).status()).toBe(200);
  const { data, error } = await fixture.db
    .from("crm_leads")
    .select("stage_id")
    .eq("id", c.lead)
    .single();
  expect(error).toBeNull();
  expect(data!.stage_id).toBe(c.stages[1]!.id);
  await evidence(page, "cliente-movimento-no-funil");
  await page.goto("/app/agenda");
  await expect(page.getByTestId("grade-da-agenda")).toBeVisible({ timeout: 90_000 });
  await evidence(page, "cliente-agenda");
});

test("todas as URLs da agência negam antes de carregar e APIs não dependem do menu", async ({
  page,
}) => {
  await login(page, "clientA");
  for (const href of [...forbiddenAreas, "/onboarding", "/onboarding/funil"]) {
    await page.goto(href);
    await expect(page).toHaveURL(/\/403(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "403 — Sem permissão" })).toBeVisible();
  }
  await evidence(page, "cliente-url-direta-negada");
  for (const path of [
    "/api/v1/ai/agents",
    "/api/v1/settings/api-tokens",
    "/api/v1/ai/routers",
    "/api/v1/ai/credentials",
    "/api/v1/ai/knowledge/sources",
    "/api/v1/webhook-sources",
    "/api/v1/tags/vocabulario",
  ]) {
    const response = await page.request.get(path);
    expect([403, 404], path).toContain(response.status());
  }
  const channels = await page.request.get("/api/v1/channel-sessions");
  expect(channels.status()).toBe(200);
  expect(await channels.text()).not.toContain("never-expose");
  const settings = await page.request.patch(`/api/v1/pipelines/${fixture.clinics.A!.pipeline}`, {
    data: { name: "Indevido" },
  });
  expect([403, 404]).toContain(settings.status());
  const stage = await page.request.post(`/api/v1/pipelines/${fixture.clinics.A!.pipeline}/stages`, {
    data: { name: "Indevida" },
  });
  expect([403, 404]).toContain(stage.status());
});

test("gestor usa conta própria, memberships oficiais e switcher com organização ativa", async ({
  page,
}) => {
  await login(page, "manager");
  const switcher = page.getByTestId("tenant-switcher");
  await expect(switcher).toContainText("Clínica A Fase 5");
  await expect(page.getByText(/acompanhando|impersonation/i)).toHaveCount(0);
  await switcher.click();
  await expect(page.getByTestId(`tenant-switcher-item-${fixture.clinics.C!.id}`)).toHaveCount(0);
  await page.getByTestId(`tenant-switcher-item-${fixture.clinics.B!.id}`).click();
  await page.waitForURL(/\/app\/inbox/);
  await expect(page.getByTestId("tenant-switcher")).toContainText("Clínica B Fase 5");
  await page.goto("/app/ai/agents");
  await expect(page).toHaveURL(/\/app\/ai\/agents/);
  await expect(page.getByRole("heading", { name: /Agents de IA/i }).first()).toBeVisible({
    timeout: 90_000,
  });
  await evidence(page, "gestor-em-b-sem-impersonation");
});

test("JWT real de login nega bases administrativas, RPC privada, cross-tenant e escalada", async ({
  page,
}) => {
  await login(page, "clientA");
  const anon = createClient(fixture.url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error } = await anon.auth.signInWithPassword({
    email: fixture.users.clientA!.email,
    password: fixture.password,
  });
  expect(error).toBeNull();
  const c = fixture.clinics.A!,
    b = fixture.clinics.B!;
  for (const [base, view] of [
    ["organizations", "operational_organizations"],
    ["crm_pipelines", "operational_crm_pipelines"],
    ["crm_stages", "operational_crm_stages"],
    ["channel_sessions", "operational_channel_sessions"],
    ["conversations", "operational_conversations"],
    ["messages", "operational_messages"],
  ]) {
    const key = base === "organizations" ? "id" : "organization_id";
    const forbidden = await anon.from(base!).select("*").eq(key, c.id);
    expect(forbidden.error).toBeNull();
    expect(forbidden.data).toEqual([]);
    const allowed = await anon.from(view!).select("*").eq(key, c.id);
    expect(allowed.error).toBeNull();
    expect(allowed.data!.length).toBeGreaterThan(0);
    expect(JSON.stringify(allowed.data)).not.toContain("never-expose");
    const foreign = await anon.from(view!).select("*").eq(key, b.id);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
  }
  const changed = await anon
    .from("user_organizations")
    .update({ role: "admin" })
    .eq("organization_id", c.id)
    .eq("user_id", fixture.users.clientA!.id)
    .select();
  expect(changed.data ?? []).toEqual([]);
  const preset = await anon
    .from("managed_client_policies")
    .update({ areas: {} })
    .eq("organization_id", c.id)
    .select();
  expect(preset.data ?? []).toEqual([]);
  const foreignWrite = await anon
    .from("crm_leads")
    .update({ title: "blocked" })
    .eq("id", b.lead)
    .select();
  expect(foreignWrite.data ?? []).toEqual([]);
  const rpc = await anon.rpc("fn_buscar_trechos_das_fontes", {
    p_organization_id: c.id,
    p_source_ids: [],
    p_embedding: `[${Array(1536).fill(0).join(",")}]`,
  });
  expect(rpc.error?.code).toBe("42501");
  const foreignApi = await page.request.get(`/api/v1/pipelines/${b.pipeline}/board`);
  expect([403, 404]).toContain(foreignApi.status());
  await page
    .context()
    .addCookies([
      { name: "active_org", value: b.id, url: new URL(test.info().project.use.baseURL!).origin },
    ]);
  await page.goto("/app/contacts");
  await expect(page.getByText("Paciente B Fase 5")).toHaveCount(0);
  await expect(page.getByText("Paciente A Fase 5").first()).toBeVisible();
  expect(auth.session?.access_token).toBeTruthy(); // Nunca registrar o JWT.
});
