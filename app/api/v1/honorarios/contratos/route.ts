/**
 * CONTRATOS DE HONORÁRIOS — o modelo de cobrança do caso (fixo, êxito ou misto).
 *
 * Módulo opcional (ADR-0002): as tabelas só existem depois que o administrador da instalação
 * instala `honorarios` em `/admin/modulos`. Enquanto não instalado, o Postgres devolve 42P01
 * (tabela inexistente) — traduzido aqui para uma mensagem clara, nunca um 500 cru.
 *
 * ⚠️ CLIENT DE SESSÃO. A RLS da migration 0480 já exige `manager`+ para escrever; a rota cobra
 * o mesmo degrau por clareza de mensagem, não como segunda régua de autoridade.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "@/lib/api/types";
import {
  createHonorariosContratoHandler,
  listHonorariosContratosHandler,
} from "@/lib/honorarios/handlers";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "honorarios_contratos" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const leadId = url.searchParams.get("lead_id");

  const supabase = await createClient();
  try {
    return ok(
      await listHonorariosContratosHandler(
        supabase,
        { organization_id: authz.org.orgId, actor: { type: "user", id: authz.user.id }, requestId },
        leadId,
      ),
      { requestId },
    );
  } catch (error) {
    if (error instanceof ApiError)
      return fail(error.code, error.message, error.status, { requestId });
    throw error;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("manager", { requestId, resource: "honorarios_contratos" });
  if (!authz.ok) return authz.response;

  try {
    const result = await createHonorariosContratoHandler(
      await createClient(),
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
      },
      await req.json().catch(() => ({})),
    );
    return ok(result, { requestId });
  } catch (error) {
    if (error instanceof ZodError)
      return fail("validation_failed", error.issues[0]?.message ?? "corpo inválido", 422, {
        requestId,
      });
    if (error instanceof ApiError)
      return fail(error.code, error.message, error.status, { requestId });
    return fail("internal_error", "Não consegui registrar os honorários.", 500, { requestId });
  }
}
