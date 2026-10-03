import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ApiError } from "@/lib/api/types";
import {
  discardDraftProposalHandler,
  getProposalHandler,
  updateDraftProposalHandler,
  proposalPatchSchema as patchSchema,
} from "@/lib/propostas/administracao";
import { createClient } from "@/lib/supabase/server";
import { sePropostasDesligadas } from "@/lib/propostas/porta";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "crm_proposals" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: params.error.flatten(),
    });
  }
  const { id } = params.data;
  const supabase = await createClient();
  const handlerCtx = {
    organization_id: authz.org.orgId,
    actor: { type: "user" as const, id: authz.user.id },
    requestId,
    idioma: authz.user.idioma,
  };
  try {
    return ok(await getProposalHandler(supabase, handlerCtx, id), { requestId });
  } catch (error) {
    if (error instanceof ApiError)
      return fail(error.code, t(error.message), error.status, { requestId });
    throw error;
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_proposals" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: params.error.flatten(),
    });
  }
  const { id } = params.data;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;
  const supabase = await createClient();
  const handlerCtx = {
    organization_id: authz.org.orgId,
    actor: { type: "user" as const, id: authz.user.id },
    requestId,
    idioma: authz.user.idioma,
  };
  try {
    return ok(await updateDraftProposalHandler(supabase, handlerCtx, id, input), { requestId });
  } catch (error) {
    if (error instanceof ApiError)
      return fail(error.code, t(error.message), error.status, { requestId });
    throw error;
  }
}

/**
 * D4, item 3 da spec ("descartar a v2 em rascunho não toca na v1") — achado
 * Importante da revisão C4: não existia rota nenhuma para desistir de um
 * rascunho. Sem ela, "Revisar" por engano (ou desistência do gerente) criava
 * a v2 e ela ficava como "o" rascunho aberto do negócio para sempre (§5.3),
 * bloqueando qualquer proposta nova até alguém enviá-la — mesmo sem querer.
 * Nunca apaga: vira `cancelada` (a v1, se houver, não é tocada — ela só sai
 * de `enviada` quando uma v2 é EFETIVAMENTE enviada, send/route.ts).
 */
export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_proposals" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: params.error.flatten(),
    });
  }
  const { id } = params.data;
  const supabase = await createClient();
  try {
    return ok(await discardDraftProposalHandler(supabase, { organization_id: authz.org.orgId, actor: { type: "user" as const, id: authz.user.id }, requestId, idioma: authz.user.idioma }, id), { requestId });
  } catch (error) {
    if (error instanceof ApiError) return fail(error.code, error.message, error.status, { requestId, details: error.details });
    throw error;
  }
}
