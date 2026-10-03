import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * Épico Operação Visível (F2ii) — knobs do anti-ban por conexão.
 *
 * GET  → todas as conexões da org com knobs efetivos (override sobre default),
 *        overrides crus, defaults e bounds (a tela explica sem cravar números).
 * PUT  → upsert de channel_knobs para UMA conexão + teto diário em
 *        channel_sessions.daily_message_limit (fonte única — regra dura nº 3).
 *        Campo null = volta ao default conservador do engine.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";
import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";
import { pacingKnobsUpdateSchema, knobsView, type ChannelKnobsRow } from "@/lib/ai/pacing-knobs";

import {
  KNOB_COLUMNS,
  lerFusoDaOrganizacao,
  salvarPacingDaConexao,
  PacingError,
} from "@/lib/ai/pacing-service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "channel_knobs" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org } = authz;

  const admin = createAdminClient();
  const [{ data: sessions, error: sErr }, { data: knobs, error: kErr }, fusoDaOrg] =
    await Promise.all([
      admin
        .from("channel_sessions")
        .select("id, waha_session_name, display_name, phone_number, status, daily_message_limit")
        .eq("organization_id", org.orgId)
        // Canal arquivado foi excluído pelo usuário: não volta como opção aqui.
        .is("archived_at", null)
        // Ritmo de envio é regra de canal de MENSAGEM. A linha de chamada de voz
        // (spec 18) não dispara nada e não tem intervalo a calibrar.
        .in("provider", [...PROVIDERS_DE_MENSAGEM])
        .order("created_at", { ascending: true }),
      admin
        .from("channel_knobs")
        .select(`channel_session_id, ${KNOB_COLUMNS}`)
        .eq("organization_id", org.orgId),
      lerFusoDaOrganizacao(admin, org.orgId),
    ]);
  if (sErr || kErr) {
    return fail("internal_error", t("Falha ao carregar conexões/knobs."), 500, { requestId });
  }

  const byuSession = new Map<string, ChannelKnobsRow>(
    (knobs ?? []).map((k) => [k.channel_session_id as string, k as unknown as ChannelKnobsRow]),
  );
  const items = (sessions ?? []).map((s) => ({
    channel_session: s,
    ...knobsView(byuSession.get(s.id) ?? null, new Date(), fusoDaOrg),
  }));
  return ok({ items }, { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "channel_knobs" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user: authUser, org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", t("Body JSON inválido."), 400, { requestId });
  }
  const parsed = pacingKnobsUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  let saved;
  try {
    saved = await salvarPacingDaConexao(createAdminClient(), org.orgId, parsed.data);
  } catch (error) {
    if (error instanceof PacingError)
      return fail(error.code, t(error.message), error.status, { requestId, ...error.details });
    throw error;
  }
  await audit({
    action: "ai.pacing_knobs_updated",
    actorUserId: authUser.id,
    organizationId: org.orgId,
    resourceType: "channel_knobs",
    resourceId: parsed.data.channel_session_id,
    metadata: {
      fields_changed: Object.keys(parsed.data).filter((field) => field !== "channel_session_id"),
    },
  });

  return ok(saved, { requestId });
}
