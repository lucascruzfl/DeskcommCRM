/** Cadastro interno de honorários. Não emite cobrança nem movimenta o caixa. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";

export const contratoCreateSchema = z
  .object({
    lead_id: z.string().uuid().nullish(),
    modelo: z.enum(["fixo", "exito", "misto"]),
    valor_fixo_cents: z.number().int().min(1).nullish(),
    percentual_exito: z.number().min(0.01).max(100).nullish(),
    repasse_advogado_pct: z.number().min(0).max(100).nullish(),
  })
  .refine(
    (v) =>
      (v.modelo === "fixo" && v.valor_fixo_cents != null) ||
      (v.modelo === "exito" && v.percentual_exito != null) ||
      (v.modelo === "misto" && v.valor_fixo_cents != null && v.percentual_exito != null),
    { message: "O modelo escolhido exige o valor/percentual correspondente." },
  );

export const parcelaCreateSchema = z.object({
  numero: z.number().int().min(1),
  vencimento: z.iso.date({ message: "Data inválida." }),
  valor_cents: z.number().int().min(1),
});

function fail(ctx: HandlerCtx, status: number, code: string, message: string): never {
  throw new ApiError(status, code, undefined, ctx.requestId, message);
}

function databaseError(ctx: HandlerCtx, error: { code?: string; message?: string }): never {
  if (error.code === "42P01") {
    fail(
      ctx,
      409,
      "module_not_installed",
      "O módulo de honorários não está instalado nesta instalação. Peça ao administrador para instalar em Configurações da instalação › Módulos.",
    );
  }
  fail(ctx, 500, "internal_error", "Não consegui registrar os honorários.");
}

function actor(ctx: HandlerCtx) {
  return {
    organizationId: ctx.organization_id,
    actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
    actorApiTokenId:
      ctx.actor.type === "api_token"
        ? ctx.actor.id
        : ctx.actor.type === "ai_agent"
          ? (ctx.actor.api_token_id ?? null)
          : null,
    requestId: ctx.requestId,
  };
}

export async function createHonorariosContratoHandler(
  db: SupabaseClient,
  ctx: HandlerCtx,
  raw: unknown,
) {
  const input = contratoCreateSchema.parse(raw);
  if (input.lead_id) {
    const { data: lead, error } = await db
      .from("crm_leads")
      .select("id")
      .eq("organization_id", ctx.organization_id)
      .eq("id", input.lead_id)
      .maybeSingle();
    if (error) databaseError(ctx, error);
    if (!lead) fail(ctx, 422, "validation_failed", "Lead inválido para esta organização.");
  }
  const { data, error } = await db
    .from("honorarios_contratos")
    .insert({
      organization_id: ctx.organization_id,
      lead_id: input.lead_id ?? null,
      modelo: input.modelo,
      valor_fixo_cents: input.valor_fixo_cents ?? null,
      percentual_exito: input.percentual_exito ?? null,
      repasse_advogado_pct: input.repasse_advogado_pct ?? null,
    })
    .select("id, lead_id, modelo, valor_fixo_cents, percentual_exito, repasse_advogado_pct")
    .single();
  if (error) {
    if (error.code === "23503")
      fail(ctx, 422, "validation_failed", "Lead inválido para esta organização.");
    databaseError(ctx, error);
  }
  if (!data) fail(ctx, 500, "internal_error", "Contrato não registrado.");
  await audit({
    ...actor(ctx),
    action: "honorarios.contrato_criado",
    resourceType: "honorarios_contrato",
    resourceId: data.id,
    metadata: { modelo: input.modelo, lead_present: !!input.lead_id },
  });
  return data;
}

export async function createHonorariosParcelaHandler(
  db: SupabaseClient,
  ctx: HandlerCtx,
  contratoId: string,
  raw: unknown,
) {
  z.string().uuid().parse(contratoId);
  const input = parcelaCreateSchema.parse(raw);
  // O MCP usa service role: a FK e a RLS sozinhas não protegem o vínculo.
  const { data: contrato, error: lookupError } = await db
    .from("honorarios_contratos")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("id", contratoId)
    .maybeSingle();
  if (lookupError) databaseError(ctx, lookupError);
  if (!contrato) fail(ctx, 422, "validation_failed", "Contrato inválido para esta organização.");
  const { data, error } = await db
    .from("honorarios_parcelas")
    .insert({
      organization_id: ctx.organization_id,
      contrato_id: contratoId,
      ...input,
    })
    .select("id, contrato_id, numero, vencimento, valor_cents, status")
    .single();
  if (error) {
    if (error.code === "23503" || error.code === "42501")
      fail(ctx, 422, "validation_failed", "Contrato inválido para esta organização.");
    if (error.code === "23505")
      fail(ctx, 422, "validation_failed", "Já existe uma parcela com este número.");
    databaseError(ctx, error);
  }
  if (!data) fail(ctx, 500, "internal_error", "Parcela não registrada.");
  await audit({
    ...actor(ctx),
    action: "honorarios.parcela_criada",
    resourceType: "honorarios_parcela",
    resourceId: data.id,
    metadata: { contrato_id: contratoId, numero: input.numero },
  });
  return data;
}

/** Mesma projeção e limite do GET; filtro explícito também sob service role. */
export async function listHonorariosContratosHandler(
  db: SupabaseClient,
  ctx: HandlerCtx,
  leadId?: string | null,
) {
  let q = db
    .from("honorarios_contratos")
    .select(
      "id, lead_id, modelo, valor_fixo_cents, percentual_exito, repasse_advogado_pct, created_at",
    )
    .eq("organization_id", ctx.organization_id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (leadId) q = q.eq("lead_id", leadId);
  const { data, error } = await q;
  if (error) databaseError(ctx, error);
  return data ?? [];
}
