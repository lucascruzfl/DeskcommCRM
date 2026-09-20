/**
 * MCP tools sobre /api/v1/leads (Spec 11 §3.1, §3.2).
 *
 *  Read:
 *   - crm_list_leads
 *   - crm_get_lead
 *  Write:
 *   - crm_create_lead
 *   - crm_update_lead
 *   - crm_move_lead_stage  (sem mirror REST direto; reusa moveLeadHandler)
 *
 * Write tools exigem role>=manager + scope mcp:write (gate no server core).
 */
import { z } from "zod";

import {
  listLeadsHandler,
  getLeadHandler,
  createLeadHandler,
  updateLeadHandler,
  moveLeadHandler,
} from "@/app/api/v1/leads/_handler";
import { cloneLeadSchema, createLeadSchema, updateLeadSchema } from "@/lib/schemas/leads";
import { resolveUserNames } from "./_users";
import type { McpContext, McpToolDefinition } from "../types";
import { TIMELINE_COLS, decodeCursor, eixoDoDossie, encodeCursor } from "@/lib/leads/timeline-query";
import { ApiError } from "@/lib/api/types";
import { moverLeadParaOutroFunil } from "@/lib/leads/mover-para-funil";

/**
 * Enriquece rows de lead com os campos de governança aditivos (G6-03):
 * `owner_user_name` (só o nome — LGPD) e `stage` ({ id, name }, o label legível
 * que o get_lead_context compõe). owner_user_id, stage_id, status e tags[] já
 * vêm na row (`select *`); nada existente muda. Dedupe de owners e stages —
 * sem N+1 numa listagem.
 */
async function enrichLeads(
  ctx: McpContext,
  leads: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  if (leads.length === 0) return leads;

  const names = await resolveUserNames(
    ctx.supabase,
    leads.map((l) => l.owner_user_id as string | null),
  );

  const stageIds = [
    ...new Set(leads.map((l) => l.stage_id).filter((id): id is string => Boolean(id))),
  ];
  const stageById = new Map<string, { id: string; name: string }>();
  if (stageIds.length > 0) {
    const { data } = await ctx.supabase
      .from("crm_stages")
      .select("id, name")
      .eq("organization_id", ctx.organizationId)
      .in("id", stageIds);
    for (const s of (data ?? []) as Array<{ id: string; name: string }>) {
      stageById.set(s.id, { id: s.id, name: s.name });
    }
  }

  return leads.map((l) => ({
    ...l,
    owner_user_name: l.owner_user_id
      ? (names.get(l.owner_user_id as string) ?? null)
      : null,
    stage: l.stage_id ? (stageById.get(l.stage_id as string) ?? null) : null,
  }));
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const listInputShape = {
  query: z.string().min(1).max(200).optional(),
  pipeline_id: z.string().uuid().optional(),
  stage_id: z.string().uuid().optional(),
  status: z.enum(["open", "won", "lost"]).optional(),
  owner_user_id: z.string().uuid().optional(),
  tag: z.string().min(1).max(40).optional(),
  source: z.string().min(1).max(120).optional(),
  created_from: z.string().datetime({ offset: true }).optional(),
  created_to: z.string().datetime({ offset: true }).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
};

export const crmListLeads: McpToolDefinition<typeof listInputShape> = {
  name: "crm_list_leads",
  description:
    "Lista leads do CRM filtrando por pipeline, stage, status e owner. Cursor base64 para paginação. " +
    "Governança por lead: owner_user_id + owner_user_name (só o nome do dono, sem email/telefone), stage ({ id, name } legível além do stage_id) e tags[].",
  inputSchema: listInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "leads",
  handler: async (input, ctx) => {
    const result = await listLeadsHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      {
        search: input.query,
        pipeline_id: input.pipeline_id,
        stage_id: input.stage_id,
        status: input.status,
        owner_user_id: input.owner_user_id,
        tag: input.tag,
        source: input.source,
        created_from: input.created_from,
        created_to: input.created_to,
        limit: input.limit,
        cursor: input.cursor,
      },
    );
    return {
      leads: await enrichLeads(ctx, result.leads),
      cursor: result.cursor,
      has_more: result.has_more,
    };
  },
};

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

const getInputShape = {
  lead_id: z.string().uuid(),
};

export const crmGetLead: McpToolDefinition<typeof getInputShape> = {
  name: "crm_get_lead",
  description:
    "Retorna um lead pelo UUID. Inclui pipeline_id, stage_id, status, owner. " +
    "Governança: owner_user_id + owner_user_name (só o nome, sem email/telefone), stage ({ id, name } legível) e tags[].",
  inputSchema: getInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "leads",
  handler: async (input, ctx) => {
    const lead = await getLeadHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      input.lead_id,
    );
    if ((lead as { organization_id?: string }).organization_id !== ctx.organizationId) {
      // Defesa em profundidade — service-role bypassa RLS.
      throw new Error("not_found");
    }
    const [enriched] = await enrichLeads(ctx, [lead]);
    return { lead: enriched };
  },
};

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

const createInputShape = {
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  contact_id: z.string().uuid().optional(),
  value_cents: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  owner_user_id: z.string().uuid().optional(),
  /** 0070: o agente pode nascer dono do negócio que ele mesmo abriu. */
  owner_agent_id: z.string().uuid().optional(),
  expected_close_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
};

export const crmCreateLead: McpToolDefinition<typeof createInputShape> = {
  name: "crm_create_lead",
  description:
    "Cria um lead no pipeline informado. Use após qualificar um contato. Position é gerenciado pelo servidor.",
  inputSchema: createInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "leads",
  auditResource: (_input, result) => ({
    type: "crm_lead",
    id: ((result as { lead?: { id?: string } } | undefined)?.lead?.id) ?? null,
  }),
  handler: async (input, ctx) => {
    const parsed = createLeadSchema.parse({
      pipeline_id: input.pipeline_id,
      stage_id: input.stage_id,
      title: input.title,
      description: input.description ?? null,
      contact_id: input.contact_id ?? null,
      value_cents: input.value_cents ?? null,
      currency: input.currency ?? "BRL",
      owner_user_id: input.owner_user_id ?? null,
      owner_agent_id: input.owner_agent_id ?? null,
      expected_close_date: input.expected_close_date ?? null,
      tags: input.tags ?? [],
      source: input.source ?? "ai_agent",
    });
    const lead = await createLeadHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      parsed,
    );
    return { lead };
  },
};

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

const updateInputShape = {
  lead_id: z.string().uuid(),
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional(),
  contact_id: z.string().uuid().optional(),
  value_cents: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  owner_user_id: z.string().uuid().optional(),
  /** 0070: transferir o negócio para (ou de) um agente — passa pelo mesmo helper. */
  owner_agent_id: z.string().uuid().optional(),
  expected_close_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  tags: z.array(z.string()).optional(),
  /**
   * Os campos que o DONO declarou em `pipeline.settings.fields`.
   *
   * Faltava aqui, e só aqui: `updateLeadSchema` já aceita a chave, o
   * `updateLeadHandler` já faz o merge com o que existe, e a mudança já vira
   * atividade na linha do tempo ("os campos personalizados"). Como o handler
   * monta `{...rest}` a partir DESTE shape, e `z.object` descarta chave que não
   * declarou, o valor morria antes de chegar ao schema que o aceitaria.
   *
   * Efeito da ausência: o produto deixa criar até 50 campos por funil, desenha
   * todos na ficha do lead — e nenhum agente conseguia preencher um. Quem
   * modelou o funil no vocabulário do próprio nicho recebia a IA como leitora,
   * nunca como escrivã.
   */
  custom_fields: z.record(z.string(), z.unknown()).optional(),
};

export const crmUpdateLead: McpToolDefinition<typeof updateInputShape> = {
  name: "crm_update_lead",
  description:
    "Atualiza campos editáveis de um lead. Stage transitions são via crm_move_lead_stage; status é gerenciado por triggers.",
  inputSchema: updateInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "leads",
  auditResource: (input) => ({ type: "crm_lead", id: input.lead_id }),
  handler: async (input, ctx) => {
    const { lead_id, ...rest } = input;
    const parsed = updateLeadSchema.parse(rest);
    const lead = await updateLeadHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      lead_id,
      parsed,
    );
    return { lead };
  },
};

// ---------------------------------------------------------------------------
// move stage
// ---------------------------------------------------------------------------

const moveInputShape = {
  lead_id: z.string().uuid(),
  to_stage_id: z.string().uuid(),
  position_in_stage: z.number().finite().optional(),
  reason: z.string().max(500).optional(),
  lost_reason: z.string().min(1).max(500).optional(),
};

export const crmMoveLeadStage: McpToolDefinition<typeof moveInputShape> = {
  name: "crm_move_lead_stage",
  description:
    "Move um lead para outro stage dentro do MESMO pipeline, preservando eventos, automações, auditoria e timeline. Para levar o negócio a outro pipeline use crm_move_lead_pipeline.",
  inputSchema: moveInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "leads",
  auditResource: (input) => ({ type: "crm_lead", id: input.lead_id }),
  handler: async (input, ctx) => {
    const lead = await moveLeadHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      input.lead_id,
      {
        to_stage_id: input.to_stage_id,
        position_in_stage: input.position_in_stage,
        reason: input.reason,
        lost_reason: input.lost_reason,
      },
    );
    return { lead };
  },
};

const movePipelineInputShape = {
  lead_id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid().optional(),
  lost_reason: z.string().min(1).max(500),
};

export const crmMoveLeadPipeline: McpToolDefinition<typeof movePipelineInputShape> = {
  name: "crm_move_lead_pipeline",
  description:
    "Leva um negócio aberto para OUTRO pipeline pela regra oficial do CRM: cria o sucessor no destino, encerra a origem e preserva eventos, automações, auditoria e timeline. Para trocar apenas de etapa no mesmo pipeline use crm_move_lead_stage.",
  inputSchema: movePipelineInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "leads",
  auditResource: (input) => ({ type: "crm_lead", id: input.lead_id }),
  handler: async (input, ctx) => {
    const { lead_id, ...fields } = input;
    const parsed = cloneLeadSchema.parse(fields);
    return moverLeadParaOutroFunil(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      lead_id,
      parsed,
    );
  },
};

const timelineShape = {
  lead_id: z.string().uuid(),
  types: z.array(z.string().min(1).max(80)).max(20).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
};

export const crmGetLeadTimeline: McpToolDefinition<typeof timelineShape> = {
  name: "crm_get_lead_timeline",
  description:
    "Lista o histórico de um negócio específico, incluindo movimentações, edições, tarefas e desfechos. Não mistura atividades de outros negócios do mesmo contato.",
  inputSchema: timelineShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "leads",
  handler: async (input, ctx) => {
    const lead = await getLeadHandler(ctx.supabase, {
      organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId,
    }, input.lead_id);
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    if (input.cursor && !cursor) throw new ApiError(400, "invalid_cursor", undefined, ctx.requestId, "Cursor inválido.");
    let q = ctx.supabase.from("crm_lead_activities").select(TIMELINE_COLS)
      .eq("organization_id", ctx.organizationId)
      .order("performed_at", { ascending: false }).order("id", { ascending: false })
      .limit(input.limit + 1);
    const eixo = eixoDoDossie(input.lead_id, (lead as { contact_id?: string | null }).contact_id ?? null);
    q = eixo ? q.or(eixo) : q.eq("lead_id", input.lead_id);
    if (input.types?.length) q = q.in("type", input.types);
    if (cursor) q = q.or(`performed_at.lt.${cursor.performed_at},and(performed_at.eq.${cursor.performed_at},id.lt.${cursor.id})`);
    const { data, error } = await q;
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page.at(-1);
    return { activities: page, has_more: hasMore, cursor: hasMore && last ? encodeCursor({ performed_at: String(last.performed_at), id: String(last.id) }) : null };
  },
};
