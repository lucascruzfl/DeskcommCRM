/**
 * GET /api/v1/webhook-sources/[id]/events — feed de recebimentos da fonte
 * (últimos 20), pra UI mostrar "chegou / não chegou" em tempo quase real
 * depois do botão "Enviar lead de teste".
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const parsedId = z.string().uuid().safeParse((await ctx.params).id);
  if (!parsedId.success) return fail("validation_failed", "Identificador inválido.", 422, { requestId });
  const authz = await requireRole("manager", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: source, error: sourceErr } = await supabase
    .from("webhook_sources")
    .select("path_token")
    .eq("id", parsedId.data)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (sourceErr) return fail("internal_error", "Não foi possível consultar a fonte.", 500, { requestId });
  if (!source) return fail("not_found", t("Fonte não encontrada."), 404, { requestId });

  const { data, error } = await supabase
    .from("webhook_events_log")
    .select("id, created_at:received_at, valid_signature, status")
    .eq("webhook_path_token", source.path_token)
    .order("received_at", { ascending: false })
    .limit(20);
  if (error) return fail("internal_error", "Não foi possível consultar os recebimentos.", 500, { requestId });

  return ok(data ?? [], { requestId });
}
