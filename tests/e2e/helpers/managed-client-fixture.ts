import { randomUUID } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import { buildManagedAreaPolicy } from "../../../lib/managed-clients/policy";

/** Sempre cria contas confirmadas e dados sintéticos no Supabase LOCAL do E2E. */
export async function managedFixture() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
    throw new Error("managed authorization fixture requires disposable localhost Supabase");
  }
  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const check = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
    if (error) throw new Error(error.message);
    return data;
  };
  const password = "Fixture-Cl!nica-2026";
  const users: Record<string, { id: string; email: string }> = {};
  for (const role of ["clientA", "clientB", "manager", "outsider"]) {
    const email = `managed-${role.toLowerCase()}-${randomUUID()}@fixture.test`;
    const { user } = check<{ user: User | null }>(
      await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Fixture ${role}` },
      }),
    );
    if (!user) throw new Error("fixture user missing");
    users[role] = { id: user.id, email };
  }
  const clinics = Object.fromEntries(
    ["A", "B", "C"].map((key) => [
      key,
      {
        id: randomUUID(),
        channel: randomUUID(),
        contact: randomUUID(),
        conversation: randomUUID(),
        lead: randomUUID(),
        pipeline: "",
        stages: [] as { id: string; name: string; is_won: boolean; is_lost: boolean }[],
        name: `Clínica ${key} Fase 5`,
      },
    ]),
  );
  const now = new Date().toISOString();
  const areas = buildManagedAreaPolicy("managed/aesthetic-clinic").areas;
  for (const key of ["A", "B", "C"]) {
    const c = clinics[key]!;
    check(
      await db.from("organizations").insert({
        id: c.id,
        slug: c.id,
        legal_name: c.name,
        display_name: c.name,
        onboarded_at: now,
        timezone: "America/Sao_Paulo",
        settings: { admin_secret: "never-expose" },
      }),
    );
  }
  check(
    await db.from("user_organizations").insert([
      {
        organization_id: clinics.A!.id,
        user_id: users.clientA!.id,
        role: "agent",
        accepted_at: now,
      },
      {
        organization_id: clinics.B!.id,
        user_id: users.clientB!.id,
        role: "agent",
        accepted_at: now,
      },
      {
        organization_id: clinics.A!.id,
        user_id: users.manager!.id,
        role: "admin",
        accepted_at: now,
      },
      {
        organization_id: clinics.B!.id,
        user_id: users.manager!.id,
        role: "admin",
        accepted_at: new Date(Date.now() + 1000).toISOString(),
      },
    ]),
  );
  for (const key of ["A", "B"]) {
    const c = clinics[key]!;
    check(
      await db.from("managed_client_policies").insert({
        organization_id: c.id,
        business_type: "aesthetic_clinic",
        management_mode: "managed",
        preset_id: "managed/aesthetic-clinic",
        preset_version: "1.0.0",
        areas,
        applied_by: users.manager!.id,
      }),
    );
    check(
      await db.from("channel_sessions").insert({
        id: c.channel,
        organization_id: c.id,
        waha_session_name: `fixture-${c.id}`,
        webhook_secret_encrypted: "\\x00",
        status: "WORKING",
        display_name: `Atendimento ${key}`,
        phone_number: `551100000000${key === "A" ? "1" : "2"}`,
      }),
    );
    check(
      await db.from("contacts").insert({
        id: c.contact,
        organization_id: c.id,
        name: `Paciente ${key} Fase 5`,
        phone_number: `+551100000000${key === "A" ? "1" : "2"}`,
      }),
    );
    check(
      await db.from("conversations").insert({
        id: c.conversation,
        organization_id: c.id,
        channel_session_id: c.channel,
        contact_id: c.contact,
        status: "open",
        metadata: { internal: "never-expose" },
      }),
    );
    check(
      await db.from("messages").insert({
        organization_id: c.id,
        conversation_id: c.conversation,
        channel_session_id: c.channel,
        contact_id: c.contact,
        type: "text",
        direction: "inbound",
        status: "received",
        sent_via: "external_device",
        body: `Quero marcar avaliação ${key}`,
        metadata: { agent_id: "never-expose", citations: [{ snippet: "never-expose" }] },
      }),
    );
    const pipelines = check(
      await db
        .from("crm_pipelines")
        .select("id")
        .eq("organization_id", c.id)
        .order("position")
        .limit(1),
    );
    c.pipeline = pipelines![0]!.id;
    c.stages = check(
      await db
        .from("crm_stages")
        .select("id,name,is_won,is_lost")
        .eq("pipeline_id", c.pipeline)
        .eq("organization_id", c.id)
        .order("position"),
    )!;
    check(
      await db.from("crm_leads").insert({
        id: c.lead,
        organization_id: c.id,
        pipeline_id: c.pipeline,
        stage_id: c.stages[0]!.id,
        contact_id: c.contact,
        title: `Avaliação ${key} Fase 5`,
        value_cents: 12000,
        currency: "BRL",
      }),
    );
  }
  return {
    db,
    url,
    users,
    clinics,
    password,
    async cleanup() {
      check(
        await db
          .from("organizations")
          .delete()
          .in(
            "id",
            Object.values(clinics).map((c) => c.id),
          ),
      );
      for (const user of Object.values(users))
        check<{ user: User | null }>(await db.auth.admin.deleteUser(user.id));
    },
  };
}
