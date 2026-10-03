/**
 * PARCELAS de um contrato de honorários — o calendário de pagamento.
 *
 * Pagar uma parcela NÃO acontece aqui: é `/api/v1/honorarios/parcelas/[id]/pagar`, que cria o
 * `financial_entries` do caixa núcleo (DIRC "integrar" — não há tabela de "pagamento" própria).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "@/lib/api/types";
import { createHonorariosParcelaHandler } from "@/lib/honorarios/handlers";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MODULO_NAO_INSTALADO =
  "O módulo de honorários não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

function moduloNaoInstalado(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "honorarios_parcelas" });
  if (!authz.ok) return authz.response;
  const { id: contratoId } = await ctx.params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("honorarios_parcelas")
    .select("id, contrato_id, numero, vencimento, valor_cents, financial_entry_id, status")
    .eq("contrato_id", contratoId)
    .order("numero", { ascending: true });

  if (error) {
    if (moduloNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("manager", { requestId, resource: "honorarios_parcelas" });
  if (!authz.ok) return authz.response;

  try {
    const result = await createHonorariosParcelaHandler(
      await createClient(),
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
      },
      (await ctx.params).id,
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
