import { z } from "zod";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { TETO_DE_LEMBRETES_EXTRAS } from "@/lib/agenda/lembretes";
import { carregarRosterDeAtendimento } from "@/lib/escalacao/atendentes";
import { availabilityPatchSchema } from "@/lib/schemas/routing";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";

const CATEGORIAS = [
  "consulta",
  "procedimento",
  "retorno",
  "visita",
  "vistoria",
  "reuniao",
  "call",
  "orcamento",
  "demonstracao",
  "outro",
] as const;
const LOCAIS = ["in_person", "phone", "whatsapp", "video_link", "google_meet"] as const;
const COLUNAS_TIPO =
  "id, name, slug, description, category, duration_minutes, slot_interval_minutes, location_kind, location_details, default_owner_user_id, requires_confirmation, is_active, buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, booking_window_days, reminder_enabled, reminder_minutes_before, reminder_extra_offsets_minutes, reminder_template_name, reminder_body, reminder_bodies, default_price_cents, created_at, updated_at";
const CAMPOS_TIPO = {
  name: z.string().trim().min(2).max(80),
  category: z.enum(CATEGORIAS),
  duration_minutes: z.number().int().min(5).max(1440),
  slot_interval_minutes: z.number().int().min(5).max(1440).nullable().optional(),
  location_kind: z.enum(LOCAIS),
  description: z.string().trim().max(500).nullable().optional(),
  location_details: z.string().trim().max(300).nullable().optional(),
  default_owner_user_id: z.string().uuid().nullable().optional(),
  requires_confirmation: z.boolean().optional(),
  buffer_before_minutes: z.number().int().min(0).max(720).optional(),
  buffer_after_minutes: z.number().int().min(0).max(720).optional(),
  minimum_notice_minutes: z.number().int().min(0).max(43_200).optional(),
  booking_window_days: z.number().int().min(1).max(365).optional(),
  reminder_enabled: z.boolean().optional(),
  reminder_minutes_before: z.number().int().min(15).max(10_080).optional(),
  reminder_extra_offsets_minutes: z
    .array(z.number().int().min(15).max(10_080))
    .max(TETO_DE_LEMBRETES_EXTRAS)
    .transform((values) => [...new Set(values)].sort((a, b) => b - a))
    .optional(),
  default_price_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
};

const CAMPOS_LEMBRETE_EDITAVEIS = {
  reminder_template_name: z.string().trim().min(1).max(200).nullable().optional(),
  reminder_body: z.string().trim().max(1000).nullable().optional(),
  reminder_bodies: z
    .record(z.string().regex(/^\d+$/), z.string().trim().min(1).max(1000))
    .optional(),
};

function slugDe(nome: string): string {
  return (
    nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "tipo"
  );
}

async function exigeMembro(ctx: McpContext, userId: string): Promise<void> {
  const { data, error } = await ctx.supabase
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  if (!data)
    throw new ApiError(
      404,
      "not_found",
      undefined,
      ctx.requestId,
      "Responsável não encontrado nesta organização.",
    );
}

function ator(ctx: McpContext) {
  return ctx.actor.type === "user" ? ctx.actor.id : null;
}

const obterTipoShape = {
  event_type_id: z.string().uuid().optional(),
  event_type_slug: z.string().min(1).max(80).optional(),
};
export const crmGetEventType: McpToolDefinition<typeof obterTipoShape> = {
  name: "crm_get_event_type",
  description:
    "Consulta a configuração completa e segura de um tipo de evento por id ou slug, inclusive duração, modalidade, responsável, buffers, antecedência, janela e status. Não cria compromisso nem altera a agenda.",
  inputSchema: obterTipoShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "appointments",
  handler: async (input, ctx) => {
    if (!input.event_type_id && !input.event_type_slug)
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        ctx.requestId,
        "Informe event_type_id ou event_type_slug.",
      );
    let q = ctx.supabase
      .from("calendar_event_types")
      .select(COLUNAS_TIPO)
      .eq("organization_id", ctx.organizationId);
    q = input.event_type_id
      ? q.eq("id", input.event_type_id)
      : q.eq("slug", input.event_type_slug!);
    const { data, error } = await q.maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    if (!data)
      throw new ApiError(
        404,
        "not_found",
        undefined,
        ctx.requestId,
        "Tipo de evento não encontrado.",
      );
    return { tipo: data };
  },
};

const criarTipoShape = CAMPOS_TIPO;
export const crmCreateEventType: McpToolDefinition<typeof criarTipoShape> = {
  name: "crm_create_event_type",
  description:
    "Cria um tipo de evento INATIVO/ativo conforme o padrão seguro do produto, sem marcar horário. Configure duração, modalidade, responsável, buffers e janela; consulte disponibilidade separadamente antes de criar compromissos.",
  inputSchema: criarTipoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "appointments",
  auditResource: (_i, r) => ({
    type: "calendar_event_type",
    id: (r as { tipo?: { id?: string } })?.tipo?.id,
  }),
  handler: async (input, ctx) => {
    if (input.default_owner_user_id) await exigeMembro(ctx, input.default_owner_user_id);
    const { data, error } = await ctx.supabase
      .from("calendar_event_types")
      .insert({ ...input, organization_id: ctx.organizationId, slug: slugDe(input.name) })
      .select(COLUNAS_TIPO)
      .single();
    if (error)
      throw new ApiError(
        error.code === "23505" ? 409 : 500,
        error.code === "23505" ? "conflict" : "internal_error",
        undefined,
        ctx.requestId,
        error.message,
      );
    await audit({
      action: "agenda.tipo_criado",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "calendar_event_types",
      resourceId: data.id,
      requestId: ctx.requestId,
      metadata: { nome: input.name, categoria: input.category, via: "mcp" },
    });
    return { tipo: data };
  },
};

const atualizarTipoShape = {
  event_type_id: z.string().uuid(),
  ...z.object(CAMPOS_TIPO).partial().shape,
  ...CAMPOS_LEMBRETE_EDITAVEIS,
};
export const crmUpdateEventType: McpToolDefinition<typeof atualizarTipoShape> = {
  name: "crm_update_event_type",
  description:
    "Edita a configuração de um tipo de evento existente sem ativá-lo, desativá-lo nem criar compromisso. O slug público permanece estável; ativação é uma operação separada.",
  inputSchema: atualizarTipoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "appointments",
  auditResource: (i) => ({ type: "calendar_event_type", id: i.event_type_id }),
  handler: async (input, ctx) => {
    const { event_type_id, ...raw } = input;
    const patch = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
    if (!Object.keys(patch).length)
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        ctx.requestId,
        "Informe ao menos um campo para alterar.",
      );
    if (input.default_owner_user_id) await exigeMembro(ctx, input.default_owner_user_id);
    const { data, error } = await ctx.supabase
      .from("calendar_event_types")
      .update(patch)
      .eq("organization_id", ctx.organizationId)
      .eq("id", event_type_id)
      .select(COLUNAS_TIPO)
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    if (!data)
      throw new ApiError(
        404,
        "not_found",
        undefined,
        ctx.requestId,
        "Tipo de evento não encontrado.",
      );
    await audit({
      action: "agenda.tipo_alterado",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "calendar_event_types",
      resourceId: event_type_id,
      requestId: ctx.requestId,
      metadata: { campos: Object.keys(patch), via: "mcp" },
    });
    return { tipo: data };
  },
};

const estadoTipoShape = { event_type_id: z.string().uuid(), active: z.boolean() };
export const crmSetEventTypeActive: McpToolDefinition<typeof estadoTipoShape> = {
  name: "crm_set_event_type_active",
  description:
    "Ativa ou inativa com segurança um tipo de evento. Inativar impede novas marcações e preserva compromissos históricos; não apaga dados nem cancela horários já existentes.",
  inputSchema: estadoTipoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "appointments",
  auditResource: (i) => ({ type: "calendar_event_type", id: i.event_type_id }),
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("calendar_event_types")
      .update({ is_active: input.active })
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.event_type_id)
      .select(COLUNAS_TIPO)
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    if (!data)
      throw new ApiError(
        404,
        "not_found",
        undefined,
        ctx.requestId,
        "Tipo de evento não encontrado.",
      );
    await audit({
      action: input.active ? "agenda.tipo_reativado" : "agenda.tipo_desativado",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "calendar_event_types",
      resourceId: input.event_type_id,
      requestId: ctx.requestId,
      metadata: { via: "mcp" },
    });
    return { tipo: data };
  },
};

const listarDisponibilidadeShape = {};
export const crmListAvailability: McpToolDefinition<typeof listarDisponibilidadeShape> = {
  name: "crm_list_availability",
  description:
    "Lista a disponibilidade publicada da equipe: fuso IANA, janelas semanais, capacidade, carga e estado disponível. É configuração; para slots livres de um atendimento use crm_find_free_slots.",
  inputSchema: listarDisponibilidadeShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "appointments",
  handler: async (_input, ctx) => ({
    disponibilidade: (
      await carregarRosterDeAtendimento(ctx.supabase, ctx.organizationId, new Date())
    ).map((r) => ({
      user_id: r.userId,
      role: r.papel,
      is_available: r.disponivel,
      capacity: r.capacidade,
      current_load: r.cargaAtual,
      schedule: r.agenda,
      updated_at: r.atualizadoEm,
    })),
  }),
};

const atualizarDisponibilidadeShape = {
  user_id: z.string().uuid(),
  is_available: availabilityPatchSchema.shape.is_available,
  capacity: availabilityPatchSchema.shape.capacity,
  schedule: availabilityPatchSchema.shape.schedule,
};
export const crmUpdateAvailability: McpToolDefinition<typeof atualizarDisponibilidadeShape> = {
  name: "crm_update_availability",
  description:
    "Atualiza jornada semanal, fuso IANA, capacidade ou disponibilidade de um membro da organização. Não cria slots nem compromissos; o motor oficial recalcula elegibilidade e horários livres.",
  inputSchema: atualizarDisponibilidadeShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "appointments",
  auditResource: (i) => ({ type: "attendant_availability", id: i.user_id }),
  handler: async (input, ctx) => {
    await exigeMembro(ctx, input.user_id);
    const { user_id, ...raw } = input;
    const parsed = availabilityPatchSchema.safeParse(raw);
    if (!parsed.success)
      throw new ApiError(
        422,
        "validation_failed",
        parsed.error.flatten(),
        ctx.requestId,
        "Disponibilidade inválida.",
      );
    const { data, error } = await ctx.supabase
      .from("attendant_availability")
      .upsert(
        {
          organization_id: ctx.organizationId,
          user_id,
          ...parsed.data,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,user_id" },
      )
      .select("user_id, is_available, capacity, schedule, updated_at")
      .single();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    await audit({
      action: "attendant.availability_changed",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "attendant_availability",
      resourceId: user_id,
      requestId: ctx.requestId,
      metadata: { fields_changed: Object.keys(parsed.data), via: "mcp" },
    });
    return { disponibilidade: data };
  },
};

const listarExcecoesShape = {
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  user_id: z.string().uuid().optional(),
};
export const crmListAvailabilityExceptions: McpToolDefinition<typeof listarExcecoesShape> = {
  name: "crm_list_availability_exceptions",
  description:
    "Lista bloqueios e aberturas excepcionais por período e responsável. Datas são dias civis YYYY-MM-DD no fuso da jornada; não são instantes UTC.",
  inputSchema: listarExcecoesShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "appointments",
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("calendar_availability_exceptions")
      .select("id, user_id, exception_date, is_unavailable, start_minute, end_minute, reason")
      .eq("organization_id", ctx.organizationId)
      .order("exception_date")
      .limit(500);
    if (input.from) q = q.gte("exception_date", input.from);
    if (input.to) q = q.lte("exception_date", input.to);
    if (input.user_id) q = q.eq("user_id", input.user_id);
    const { data, error } = await q;
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    return { excecoes: data ?? [] };
  },
};

const criarExcecaoShape = {
  user_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  unavailable: z.boolean().default(true),
  start_minute: z.number().int().min(0).max(1439).default(0),
  end_minute: z.number().int().min(1).max(1440).default(1440),
  reason: z.string().trim().max(200).optional(),
};
export const crmCreateAvailabilityException: McpToolDefinition<typeof criarExcecaoShape> = {
  name: "crm_create_availability_exception",
  description:
    "Cria bloqueio (unavailable=true) ou abertura excepcional em um dia civil da agenda. Não use compromisso falso para bloquear horário; esta é a configuração oficial.",
  inputSchema: criarExcecaoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "appointments",
  auditResource: (_i, r) => ({
    type: "calendar_availability_exception",
    id: (r as { excecao?: { id?: string } })?.excecao?.id,
  }),
  handler: async (input, ctx) => {
    if (input.end_minute <= input.start_minute)
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        ctx.requestId,
        "end_minute deve ser maior que start_minute.",
      );
    await exigeMembro(ctx, input.user_id);
    const { data, error } = await ctx.supabase
      .from("calendar_availability_exceptions")
      .insert({
        organization_id: ctx.organizationId,
        user_id: input.user_id,
        exception_date: input.date,
        is_unavailable: input.unavailable,
        start_minute: input.start_minute,
        end_minute: input.end_minute,
        reason: input.reason ?? null,
      })
      .select("id, user_id, exception_date, is_unavailable, start_minute, end_minute, reason")
      .single();
    if (error)
      throw new ApiError(
        error.code === "23505" ? 409 : 500,
        error.code === "23505" ? "conflict" : "internal_error",
        undefined,
        ctx.requestId,
        error.message,
      );
    await audit({
      action: input.unavailable ? "agenda.dia_bloqueado" : "agenda.dia_aberto",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "calendar_availability_exception",
      resourceId: data.id,
      requestId: ctx.requestId,
      metadata: { date: input.date, user_id: input.user_id, via: "mcp" },
    });
    return { excecao: data };
  },
};

const removerExcecaoShape = { exception_id: z.string().uuid() };
export const crmDeleteAvailabilityException: McpToolDefinition<typeof removerExcecaoShape> = {
  name: "crm_delete_availability_exception",
  description:
    "Remove uma exceção futura de disponibilidade e devolve a jornada semanal ao controle daquele período. A remoção é auditada e não altera compromissos existentes.",
  inputSchema: removerExcecaoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "appointments",
  capabilities: ["destructive_operations"],
  auditResource: (i) => ({ type: "calendar_availability_exception", id: i.exception_id }),
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("calendar_availability_exceptions")
      .delete()
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.exception_id)
      .select("id, exception_date")
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    if (!data)
      throw new ApiError(404, "not_found", undefined, ctx.requestId, "Exceção não encontrada.");
    await audit({
      action: "agenda.bloqueio_removido",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "calendar_availability_exception",
      resourceId: input.exception_id,
      requestId: ctx.requestId,
      metadata: { exception_date: data.exception_date, via: "mcp" },
    });
    return { removed: true, exception_id: input.exception_id };
  },
};

export const AGENDA_ADMIN_MCP_TOOLS = [
  crmGetEventType,
  crmCreateEventType,
  crmUpdateEventType,
  crmSetEventTypeActive,
  crmListAvailability,
  crmUpdateAvailability,
  crmListAvailabilityExceptions,
  crmCreateAvailabilityException,
  crmDeleteAvailabilityException,
] as const;
