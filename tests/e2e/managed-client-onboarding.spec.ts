import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "./helpers/test";
import { managedFixture } from "./helpers/managed-client-fixture";
import { createManagedOnboardingService } from "../../lib/managed-clients/onboarding";
import { audit } from "../../lib/audit";

let fixture: Awaited<ReturnType<typeof managedFixture>>;
let organizationId: string;
const requestId = randomUUID();

test.describe.configure({ timeout: 300_000 });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app\//, { timeout: 120_000 });
}

async function screenshot(page: Page, name: string) {
  mkdirSync("evidence/managed", { recursive: true });
  const body = await page.screenshot({ path: `evidence/managed/${name}.png`, fullPage: true });
  await test.info().attach(name, { body, contentType: "image/png" });
}

test.beforeAll(async () => {
  fixture = await managedFixture();
  const manager = fixture.users.manager!;
  const client = fixture.users.outsider!;
  const { error: adminError } = await fixture.db.from("platform_admins").insert({
    user_id: manager.id, granted_by: manager.id, scope: "full", mfa_required: false,
    reason: "Fixture descartável de onboarding",
  });
  if (adminError) throw adminError;

  // O transporte de e-mail é substituído somente dentro deste processo E2E.
  // Nenhum destinatário real recebe mensagem ou URL de convite.
  const onboarding = createManagedOnboardingService({
    admin: () => fixture.db,
    emailConfigured: async () => true,
    issueInvite: async (input) => ({
      email: input.email, invite_id: input.inviteId!, expires_at: new Date(Date.now() + 86400000).toISOString(),
      email_dispatched: true, email_error: undefined, accept_url: "fixture-only-no-email",
    }),
    audit,
  });
  const input = {
    organization_name: `Clínica Fase 6 ${requestId.slice(0, 8)}`,
    preset: "managed/aesthetic-clinic" as const,
    client_email: client.email,
    idempotency_key: requestId,
  };
  const actor = { userId: manager.id, sourceOrganizationId: fixture.clinics.A!.id,
    requestId, apiTokenId: null };
  const preflight = await onboarding.preflight(input, actor);
  expect(preflight.can_execute).toBe(true);
  expect(preflight.requires_confirmation).toBe(true);
  expect(preflight.client.role).toBe("agent");
  expect(preflight.agency_membership.role).toBe("admin");
  expect((await fixture.db.from("organizations").select("id").eq("slug", preflight.slug)).data).toEqual([]);
  const result = await onboarding.execute(input, actor, true);
  expect(result).toMatchObject({ status: "completed", client_role: "agent", agency_role: "admin" });
  if (!("organization_id" in result)) throw new Error("onboarding did not create organization");
  organizationId = result.organization_id;
  expect(await onboarding.execute(input, actor, true)).toMatchObject({
    status: "already_completed", organization_id: organizationId,
  });
  const [{ data: orgs }, { data: policies }, { data: managerLinks }, { data: invites }, { data: receipts }] = await Promise.all([
    fixture.db.from("organizations").select("id").eq("id", organizationId),
    fixture.db.from("managed_client_policies").select("preset_id").eq("organization_id", organizationId),
    fixture.db.from("user_organizations").select("role, accepted_at").eq("organization_id", organizationId).eq("user_id", manager.id),
    fixture.db.from("team_invites").select("id").eq("organization_id", organizationId).eq("email", client.email),
    fixture.db.from("managed_client_onboardings").select("state").eq("organization_id", organizationId),
  ]);
  expect([orgs?.length, policies?.length, managerLinks?.length, invites?.length, receipts?.length]).toEqual([1, 1, 1, 1, 1]);
  expect(managerLinks?.[0]?.role).toBe("admin");
  expect(policies?.[0]?.preset_id).toBe("managed/aesthetic-clinic");
  expect(receipts?.[0]?.state).toBe("completed");

  // Equivale ao aceite humano no ambiente descartável, sem criar senha na aplicação.
  const { error: acceptError } = await fixture.db.rpc("fn_accept_team_invite", {
    p_user: client.id, p_org: organizationId, p_role: "agent", p_invited_by: manager.id,
    p_issued_at: new Date().toISOString(), p_invited_at: new Date().toISOString(),
    p_interface_settings: { preset: "completa" },
  });
  if (acceptError) throw acceptError;
});

test.afterAll(async () => {
  if (!fixture) return;
  if (organizationId) await fixture.db.from("organizations").delete().eq("id", organizationId);
  await fixture.db.from("platform_admins").delete().eq("user_id", fixture.users.manager!.id);
  await fixture.cleanup();
});

test("gestor acessa a clínica criada pelo switcher e administra área da agência", async ({ page }) => {
  await login(page, fixture.users.manager!.email, fixture.password);
  const switcher = page.getByTestId("tenant-switcher");
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page.getByTestId(`tenant-switcher-item-${organizationId}`).click();
  await page.waitForURL(/\/app\//);
  await expect(page.getByTestId("tenant-switcher")).toContainText("Clínica Fase 6");
  await page.goto("/app/ai/agents");
  await expect(page).toHaveURL(/\/app\/ai\/agents/);
  await expect(page.getByRole("heading", { name: /Agents de IA/i }).first()).toBeVisible();
  await screenshot(page, "fase6-gestor-area-agencia");
});

test("cliente agent acessa operação e recebe 403 nas áreas da agência", async ({ page }) => {
  await login(page, fixture.users.outsider!.email, fixture.password);
  await page.goto("/app/inbox");
  await expect(page).toHaveURL(/\/app\/inbox/);
  await expect(page.locator('a[href="/app/ai/agents"]')).toHaveCount(0);
  await expect(page.getByTestId("tenant-switcher")).toHaveCount(0);
  await page.goto("/app/contacts");
  await expect(page).toHaveURL(/\/app\/contacts/);
  const clientDb = createClient(fixture.url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await clientDb.auth.signInWithPassword({
    email: fixture.users.outsider!.email, password: fixture.password,
  });
  expect(loginError).toBeNull();
  const own = await clientDb.from("operational_organizations").select("id").eq("id", organizationId);
  const foreign = await clientDb.from("operational_organizations").select("id").eq("id", fixture.clinics.A!.id);
  expect(own.error).toBeNull();
  expect(own.data).toHaveLength(1);
  expect(foreign.error).toBeNull();
  expect(foreign.data).toEqual([]);
  await page.goto("/app/ai/agents");
  await expect(page).toHaveURL(/\/403(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "403 — Sem permissão" })).toBeVisible();
  await screenshot(page, "fase6-cliente-area-negada");
});

test("MCP real faz handshake, nega admin comum e cria uma vez com confirmação", async ({ request }) => {
  let acceptedMessages = 0;
  const smtp = createServer((socket) => {
    socket.write("220 fixture.local ESMTP\r\n");
    let buffer = "";
    let inData = false;
    socket.on("data", (bytes) => {
      buffer += bytes.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") { inData = false; acceptedMessages++; socket.write("250 queued\r\n"); }
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith("DATA")) { inData = true; socket.write("354 end with dot\r\n"); }
        else if (command.startsWith("QUIT")) socket.end("221 bye\r\n");
        else socket.write("250 fixture.local\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  const address = smtp.address();
  if (!address || typeof address === "string") throw new Error("SMTP fixture unavailable");
  const { data: previousSmtp, error: readSmtpError } = await fixture.db
    .from("platform_smtp_settings").select("*").eq("id", 1).maybeSingle();
  if (readSmtpError) throw readSmtpError;
  const manager = fixture.users.manager!;
  const { error: smtpError } = await fixture.db.from("platform_smtp_settings").upsert({
    id: 1, smtp_host: "127.0.0.1", smtp_port: address.port, smtp_security: "none",
    smtp_username: null, smtp_password_encrypted: null,
    from_email: "fixture@local.test", from_name: "Fixture", updated_by: manager.id,
  });
  if (smtpError) throw smtpError;

  const tokens: string[] = [];
  let newOrg: string | null = null;
  let ordinaryUser: string | null = null;
  async function token(user: string, role: "admin" | "manager" | "agent" = "manager") {
    const id = randomUUID();
    const prefix = `dsk_${randomBytes(4).toString("hex")}`;
    const value = `${prefix}_${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(value).digest("hex");
    const { error } = await fixture.db.from("api_tokens").insert({
      id, organization_id: fixture.clinics.A!.id, created_by: user,
      name: "Fixture onboarding", prefix, token_hash: `\\x${hash}`,
      scopes: [`role:${role}`, "mcp:read", "mcp:write", "capability:managed_client_onboarding"],
    });
    if (error) throw error;
    tokens.push(id);
    return value;
  }
  async function call(bearer: string, id: number, method: string, params: object) {
    const response = await request.post("/api/mcp", {
      headers: { authorization: `Bearer ${bearer}`, accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id, method, params },
    });
    expect(response.status()).toBe(200);
    const body = await response.text();
    const frames = body.trim().startsWith("{") ? [JSON.parse(body)] : body.split("\n")
      .filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
    return frames.find((frame: { id?: number }) => frame.id === id) as {
      result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean };
      error?: unknown;
    };
  }
  function payload(frame: Awaited<ReturnType<typeof call>>) {
    expect(frame.error).toBeUndefined();
    expect(frame.result?.isError).not.toBe(true);
    const content = frame.result?.content?.find((item) => item.text);
    if (!content) throw new Error("MCP result absent");
    return JSON.parse(content.text) as Record<string, unknown>;
  }
  try {
    const authorizedToken = await token(manager.id);
    expect((await call(authorizedToken, 1, "initialize", {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "phase6-fixture", version: "1" },
    })).result).toBeDefined();
    const listed = await call(authorizedToken, 2, "tools/list", {});
    expect(listed.result?.tools?.map((tool) => tool.name)).toContain("crm_preflight_managed_client");
    expect(listed.result?.tools?.map((tool) => tool.name)).toContain("crm_create_managed_client");
    const suffix = randomUUID().slice(0, 8);
    const input = { organization_name: `Clínica MCP ${suffix}`, slug: `clinica-mcp-${suffix}`,
      preset: "managed/aesthetic-clinic", client_email: `client-mcp-${randomUUID()}@fixture.test` };
    const legacyPreflight = payload(await call(authorizedToken, 8, "tools/call", {
      name: "crm_preflight_managed_client",
      arguments: { name: input.organization_name, business_type: "aesthetic_clinic",
        management_mode: "managed", client_email: input.client_email, slug: input.slug },
    }));
    expect(legacyPreflight.can_execute).toBe(true);
    const preflight = payload(await call(authorizedToken, 3, "tools/call", {
      name: "crm_create_managed_client", arguments: input,
    }));
    expect(preflight.can_execute).toBe(true);
    expect(preflight.requires_confirmation).toBe(true);
    expect((await fixture.db.from("organizations").select("id").eq("slug", preflight.slug as string)).data).toEqual([]);

    const ordinary = await fixture.db.auth.admin.createUser({
      email: `ordinary-${randomUUID()}@fixture.test`, password: fixture.password, email_confirm: true,
    });
    if (ordinary.error || !ordinary.data.user) throw ordinary.error ?? new Error("ordinary user missing");
    ordinaryUser = ordinary.data.user.id;
    const { error: memberError } = await fixture.db.from("user_organizations").insert({
      organization_id: fixture.clinics.A!.id, user_id: ordinaryUser, role: "admin",
      accepted_at: new Date().toISOString(),
    });
    if (memberError) throw memberError;
    for (const [role, user] of [
      ["admin", ordinaryUser], ["manager", ordinaryUser], ["agent", fixture.users.clientA!.id],
    ] as const) {
      const deniedToken = await token(user, role);
      const deniedList = await call(deniedToken, 4, "tools/list", {});
      expect(deniedList.result?.tools?.map((tool) => tool.name)).not.toContain("crm_create_managed_client");
      const denied = await call(deniedToken, 5, "tools/call", {
        name: "crm_create_managed_client", arguments: { ...input, confirm: true },
      });
      expect(denied.result?.isError || denied.error).toBeTruthy();
    }

    const created = payload(await call(authorizedToken, 6, "tools/call", {
      name: "crm_create_managed_client", arguments: { ...input, confirm: true },
    }));
    expect(created).toMatchObject({ status: "completed", client_role: "agent", agency_role: "admin" });
    expect(JSON.stringify(created)).not.toContain("accept_url");
    expect(JSON.stringify(created)).not.toContain("/team/accept-invite/");
    newOrg = created.organization_id as string;
    const repeated = payload(await call(authorizedToken, 7, "tools/call", {
      name: "crm_create_managed_client", arguments: { ...input, confirm: true },
    }));
    expect(repeated).toMatchObject({ status: "already_completed", organization_id: newOrg });
    expect(acceptedMessages).toBe(1);
    for (const table of ["organizations", "managed_client_policies", "team_invites", "managed_client_onboardings"]) {
      const column = table === "organizations" ? "id" : "organization_id";
      const { data, error } = await fixture.db.from(table).select(column).eq(column, newOrg);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
  } finally {
    if (newOrg) await fixture.db.from("organizations").delete().eq("id", newOrg);
    if (tokens.length) await fixture.db.from("api_tokens").delete().in("id", tokens);
    if (ordinaryUser) await fixture.db.auth.admin.deleteUser(ordinaryUser);
    if (previousSmtp) await fixture.db.from("platform_smtp_settings").upsert(previousSmtp);
    else await fixture.db.from("platform_smtp_settings").delete().eq("id", 1);
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  }
});
