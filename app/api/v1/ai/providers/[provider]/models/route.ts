/**
 * GET /api/v1/ai/providers/:provider/models
 *
 * Lê do catálogo curado `ai_models` (tabela GLOBAL, RLS read-all).
 * Retorna modelos não-deprecated ordenados por default-first depois preço.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ehProvedorSuportado } from "@/lib/ai/pontos/provedores";

export const dynamic = "force-dynamic";

// A lista única (`lib/ai/pontos/provedores.ts`) — não uma quarta cópia. Esta
// rota alimenta o seletor de modelos; com a lista velha, pedir os modelos da
// OpenRouter devolvia "provedor desconhecido" para um provedor que a tela ao
// lado oferecia.

const MODEL_COLUMNS =
  "id, provider, model_id, display_name, description, context_window, input_price_per_million_cents, output_price_per_million_cents, supports_tools, is_default_for_provider, deprecated_at, released_at";
const providerSchema = z.string().refine(ehProvedorSuportado);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const parsed = providerSchema.safeParse((await ctx.params).provider);

  if (!parsed.success) {
    return fail("not_found", "Provider desconhecido.", 404, { requestId });
  }
  const authz = await requireRole("manager", { requestId, resource: "ai_providers" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_models")
    .select(MODEL_COLUMNS)
    .eq("provider", parsed.data)
    .is("deprecated_at", null)
    .order("is_default_for_provider", { ascending: false })
    .order("input_price_per_million_cents", { ascending: true });

  if (error) {
    return fail("internal_error", "Erro ao listar modelos.", 500, { requestId });
  }

  return ok({ models: data ?? [] }, { requestId });
}
