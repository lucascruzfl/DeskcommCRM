import { z } from "zod";

import { cancelarAcao, carregarCampanha, duplicarAcao, pausarAcao, prepararAcao } from "@/lib/campanhas/acoes";
import { FILTRO_VAZIO } from "@/lib/campanhas/audiencia";
import { ehTerminal } from "@/lib/campanhas/maquina-de-estados";
import { progresso, taxasDaCampanha, type ContagemDaCampanha } from "@/lib/campanhas/metricas";
import { preverAudiencia } from "@/lib/campanhas/preparacao";
import { gravarPool, lerPoolExtra } from "@/lib/campanhas/pool-de-numeros";
import { criarCampanhaSchema, editarCampanhaSchema, previaSchema, ritmoSchema } from "@/lib/campanhas/schemas";
import { McpToolError } from "@/lib/mcp/errors";
import { humanAction } from "@/lib/mcp/human-action";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";

const uuid = z.string().uuid();
const campaignColumns = "id, name, description, status, channel_session_id, message_body, base_legal, lia_ref, audience_filter, audience_version, content_version, snapshot_total, snapshot_eligible, snapshot_excluded, scheduled_at, created_at, pipeline_id, stage_id, agent_id";

function erro(code: ConstructorParameters<typeof McpToolError>[0], message: string): never {
  throw new McpToolError(code, message);
}

async function campanha(ctx: McpContext, id: string) {
  const found = await carregarCampanha(ctx.supabase, ctx.organizationId, id);
  if (!found.ok) erro("not_found", found.mensagem);
  return found.campanha;
}

async function validarCanais(ctx: McpContext, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const { data, error } = await ctx.supabase.from("channel_sessions").select("id")
    .eq("organization_id", ctx.organizationId).in("id", unique);
  if (error) erro("provider_unavailable", "Não consegui validar os números da campanha.");
  const found = new Set((data ?? []).map((item) => item.id));
  if (unique.some((id) => !found.has(id)))
    erro("cross_tenant_denied", "Uma conexão não pertence à organização.");
}

const redigir = (args: Record<string, unknown>) => ({
  campaign_id: args.campaign_id,
  fields: Object.keys(args).filter((key) => key !== "campaign_id"),
});

const listShape = { status: z.string().max(20).optional(), limit: z.number().int().min(1).max(100).default(30) };
const list: McpToolDefinition<typeof listShape> = {
  name: "crm_list_campaigns", description: "Lista campanhas da organização e seus estados, sem iniciar envios.",
  inputSchema: listShape, category: "read", requiresRole: "manager", requiresScope: "mcp:read", domain: "campaigns",
  handler: async (input, ctx) => {
    let query = ctx.supabase.from("campaigns").select(campaignColumns)
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false }).limit(input.limit);
    if (input.status) query = query.eq("status", input.status);
    const { data, error } = await query;
    if (error) erro("provider_unavailable", "Não consegui listar campanhas.");
    return { campaigns: data ?? [] };
  },
};

const idShape = { campaign_id: uuid };
const get: McpToolDefinition<typeof idShape> = {
  name: "crm_get_campaign", description: "Consulta uma campanha e os números de envio da mesma organização.",
  inputSchema: idShape, category: "read", requiresRole: "manager", requiresScope: "mcp:read", domain: "campaigns",
  handler: async (input, ctx) => ({
    campaign: await campanha(ctx, input.campaign_id),
    channel_session_ids: await lerPoolExtra(ctx.supabase, ctx.organizationId, input.campaign_id),
  }),
};

const previewShape = previaSchema.shape;
const preview: McpToolDefinition<typeof previewShape> = {
  name: "crm_preview_campaign", description: "Usa a prévia oficial para contar elegíveis e exclusões antes de preparar uma campanha.",
  inputSchema: previewShape, category: "read", requiresRole: "manager", requiresScope: "mcp:read", domain: "campaigns",
  redigirParaAuditoria: redigir,
  handler: async (input, ctx) => {
    const parsed = previaSchema.parse(input);
    if (parsed.campaign_id) await campanha(ctx, parsed.campaign_id);
    return preverAudiencia(ctx.supabase, {
      organizationId: ctx.organizationId, filtro: parsed.audience_filter,
      corpo: parsed.message_body, agora: new Date(), campanhaId: parsed.campaign_id,
    });
  },
};

const createShape = criarCampanhaSchema.shape;
const create: McpToolDefinition<typeof createShape> = {
  name: "crm_create_campaign_draft", description: "Cria um rascunho de campanha validado, sem preparar público nem enviar mensagem.",
  inputSchema: createShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  redigirParaAuditoria: redigir,
  auditResource: (_input, result) => ({ type: "campaign", id: (result as { campaign?: { id?: string } })?.campaign?.id }),
  handler: async (input, ctx) => {
    const data = criarCampanhaSchema.parse(input);
    await validarCanais(ctx, [data.channel_session_id, ...(data.channel_session_ids ?? [])]);
    const { data: created, error } = await ctx.supabase.from("campaigns").insert({
      organization_id: ctx.organizationId, name: data.name, description: data.description ?? null,
      channel_session_id: data.channel_session_id, message_body: data.message_body ?? null,
      base_legal: data.base_legal, lia_ref: data.lia_ref ?? null,
      audience_filter: data.audience_filter ?? FILTRO_VAZIO,
      intervalo_segundos: data.intervalo_segundos ?? null,
      janela_inicio_hora: data.janela_inicio_hora ?? null,
      janela_fim_hora: data.janela_fim_hora ?? null,
      teto_diario: data.teto_diario ?? null, teto_horario: data.teto_horario ?? null,
      pipeline_id: data.pipeline_id ?? null, stage_id: data.stage_id ?? null,
      agent_id: data.agent_id ?? null, created_by: ctx.provisionedByUserId ?? null,
    }).select(campaignColumns).single();
    if (error || !created) erro("provider_unavailable", "Não consegui criar o rascunho.");
    if ((data.channel_session_ids ?? []).length) {
      const pool = await gravarPool(ctx.supabase, {
        organizationId: ctx.organizationId, campanhaId: created.id,
        principal: data.channel_session_id, extras: data.channel_session_ids ?? [],
      });
      if (!pool.ok) erro("cross_tenant_denied", "Um número extra não pertence à organização.");
    }
    return { campaign: created };
  },
};

const updateShape = { campaign_id: uuid, ...editarCampanhaSchema.shape };
const update: McpToolDefinition<typeof updateShape> = {
  name: "crm_update_campaign_draft", description: "Edita somente um rascunho, preservando versão de conteúdo e isolamento do canal.",
  inputSchema: updateShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  redigirParaAuditoria: redigir,
  auditResource: (input) => ({ type: "campaign", id: input.campaign_id }),
  handler: async (input, ctx) => {
    const { campaign_id, ...changes } = input;
    const parsed = editarCampanhaSchema.parse(changes);
    const current = await campanha(ctx, campaign_id);
    if (current.status !== "draft") erro("conflict", "Somente um rascunho aceita edição pelo MCP.");
    const baseLegal = parsed.base_legal ?? current.base_legal;
    const liaRef = parsed.lia_ref === undefined ? current.lia_ref : parsed.lia_ref;
    if (baseLegal === "legitimate_interest" && !(liaRef ?? "").trim())
      erro("validation_error", "Interesse legítimo exige referência LIA.");
    await validarCanais(ctx, [parsed.channel_session_id ?? current.channel_session_id, ...(parsed.channel_session_ids ?? [])]);
    const { channel_session_ids, ...fields } = parsed;
    const mutation: Record<string, unknown> = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    if (parsed.message_body !== undefined && parsed.message_body !== current.message_body)
      mutation.content_version = current.content_version + 1;
    if (ctx.provisionedByUserId) mutation.updated_by = ctx.provisionedByUserId;
    const { data, error } = await ctx.supabase.from("campaigns").update(mutation)
      .eq("organization_id", ctx.organizationId).eq("id", campaign_id).eq("status", "draft")
      .select(campaignColumns).maybeSingle();
    if (error || !data) erro("conflict", "O rascunho mudou; recarregue antes de editar.");
    if (channel_session_ids !== undefined) {
      const pool = await gravarPool(ctx.supabase, {
        organizationId: ctx.organizationId, campanhaId: campaign_id,
        principal: data.channel_session_id, extras: channel_session_ids,
      });
      if (!pool.ok) erro("cross_tenant_denied", "Um número extra não pertence à organização.");
    }
    return { campaign: data };
  },
};

const pacingShape = { campaign_id: uuid, ...ritmoSchema.shape, channel_session_ids: z.array(uuid).max(10).optional() };
const pacing: McpToolDefinition<typeof pacingShape> = {
  name: "crm_update_campaign_pacing", description: "Ajusta ritmo e pool de números mesmo durante uma campanha viva, sem mudar conteúdo congelado.",
  inputSchema: pacingShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  auditResource: (input) => ({ type: "campaign", id: input.campaign_id }),
  handler: async (input, ctx) => {
    const current = await campanha(ctx, input.campaign_id);
    if (ehTerminal(current.status)) erro("conflict", "Campanha encerrada não aceita ajuste de ritmo.");
    const { campaign_id, channel_session_ids, ...rhythm } = input;
    const parsed = ritmoSchema.parse(rhythm);
    const start = parsed.janela_inicio_hora !== undefined ? parsed.janela_inicio_hora : current.janela_inicio_hora;
    const end = parsed.janela_fim_hora !== undefined ? parsed.janela_fim_hora : current.janela_fim_hora;
    if (start !== null && end !== null && end <= start)
      erro("validation_error", "A janela precisa terminar depois de começar.");
    if (channel_session_ids) await validarCanais(ctx, [current.channel_session_id, ...channel_session_ids]);
    const mutation: Record<string, unknown> = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined));
    if (ctx.provisionedByUserId) mutation.updated_by = ctx.provisionedByUserId;
    const { data, error } = await ctx.supabase.from("campaigns").update(mutation)
      .eq("organization_id", ctx.organizationId).eq("id", campaign_id)
      .select(campaignColumns).maybeSingle();
    if (error || !data) erro("conflict", "Não consegui ajustar o ritmo.");
    if (channel_session_ids !== undefined) {
      const pool = await gravarPool(ctx.supabase, {
        organizationId: ctx.organizationId, campanhaId: campaign_id,
        principal: data.channel_session_id, extras: channel_session_ids,
      });
      if (!pool.ok) erro("cross_tenant_denied", "Um número extra não pertence à organização.");
    }
    return { campaign: data };
  },
};

const metrics: McpToolDefinition<typeof idShape> = {
  name: "crm_get_campaign_metrics", description: "Conta envios e respostas a partir dos destinatários, com indicação de resultado parcial.",
  inputSchema: idShape, category: "read", requiresRole: "manager", requiresScope: "mcp:read", domain: "campaigns",
  handler: async (input, ctx) => {
    await campanha(ctx, input.campaign_id);
    const { data, error } = await ctx.supabase.from("campaign_recipients")
      .select("status, eligibility_status, sent_at, delivered_at, read_at, replied_at, opted_out_at")
      .eq("organization_id", ctx.organizationId).eq("campaign_id", input.campaign_id).limit(20_000);
    if (error) erro("provider_unavailable", "Não consegui consultar métricas.");
    const rows = data ?? [];
    const count: ContagemDaCampanha = {
      total: rows.length, elegiveis: rows.filter((r) => r.eligibility_status === "eligible").length,
      excluidos: rows.filter((r) => r.eligibility_status === "excluded").length,
      pendentes: rows.filter((r) => r.status === "pending").length,
      naFila: rows.filter((r) => r.status === "queued").length,
      enviando: rows.filter((r) => r.status === "sending").length,
      enviados: rows.filter((r) => r.sent_at !== null).length,
      entregues: rows.filter((r) => r.delivered_at !== null).length,
      lidos: rows.filter((r) => r.read_at !== null).length,
      responderam: rows.filter((r) => r.replied_at !== null).length,
      falharam: rows.filter((r) => r.status === "failed").length,
      cancelados: rows.filter((r) => r.status === "cancelled").length,
      optOut: rows.filter((r) => r.opted_out_at !== null).length,
    };
    return { contagem: count, taxas: taxasDaCampanha(count), progresso: progresso(count), parcial: rows.length >= 20_000 };
  },
};

const prepare: McpToolDefinition<typeof idShape> = {
  name: "crm_prepare_campaign", description: "Congela público da campanha pela máquina de estados oficial; não inicia envio.",
  inputSchema: idShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  auditResource: (input) => ({ type: "campaign", id: input.campaign_id }),
  handler: async (input, ctx) => {
    const result = await prepararAcao(ctx.supabase, await campanha(ctx, input.campaign_id), new Date());
    if (!result.ok) erro("conflict", result.mensagem);
    return result;
  },
};

const pause: McpToolDefinition<typeof idShape> = {
  name: "crm_pause_campaign", description: "Pausa uma campanha pela transição canônica para interromper novos envios.",
  inputSchema: idShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  auditResource: (input) => ({ type: "campaign", id: input.campaign_id }),
  handler: async (input, ctx) => {
    const result = await pausarAcao(ctx.supabase, await campanha(ctx, input.campaign_id), new Date());
    if (!result.ok) erro("conflict", result.mensagem);
    return result;
  },
};

const cancel: McpToolDefinition<typeof idShape> = {
  name: "crm_cancel_campaign", description: "Cancela definitivamente novos envios, preservando o histórico.",
  inputSchema: idShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  capabilities: ["destructive_operations"],
  auditResource: (input) => ({ type: "campaign", id: input.campaign_id }),
  handler: async (input, ctx) => {
    const result = await cancelarAcao(ctx.supabase, await campanha(ctx, input.campaign_id), new Date());
    if (!result.ok) erro("conflict", result.mensagem);
    return result;
  },
};

const duplicate: McpToolDefinition<typeof idShape> = {
  name: "crm_duplicate_campaign", description: "Cria novo rascunho a partir de uma campanha, sem herdar destinatários ou envios.",
  inputSchema: idShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  auditResource: (_input, result) => ({ type: "campaign", id: (result as { id?: string })?.id }),
  handler: async (input, ctx) => {
    if (!ctx.provisionedByUserId) erro("not_allowed", "Duplicar campanha exige token vinculado a um usuário.");
    const result = await duplicarAcao(ctx.supabase, await campanha(ctx, input.campaign_id), ctx.provisionedByUserId);
    if (!result.ok) erro("conflict", result.mensagem);
    return result;
  },
};

const start: McpToolDefinition<typeof idShape> = {
  name: "crm_prepare_campaign_launch", description: "Confere a campanha e entrega a confirmação humana para iniciar envios em massa.",
  inputSchema: idShape, category: "read", requiresRole: "manager", requiresScope: "mcp:read", domain: "campaigns",
  handler: async (input, ctx) => {
    const found = await campanha(ctx, input.campaign_id);
    return humanAction({ code: "campaign_launch_confirmation_required", reason: "mass_messaging_requires_human_confirmation",
      resource: { type: "campaign", id: found.id },
      instruction: "Confira público, base legal, ritmo e mensagem na tela antes de iniciar, agendar ou enviar teste.",
      href: `/app/campaigns/${found.id}`, endpoint: `/api/v1/campaigns/${found.id}/iniciar`, method: "POST" });
  },
};

export const CAMPAIGN_MCP_TOOLS = [list, get, preview, create, update, pacing, metrics, prepare, pause, cancel, duplicate, start] as unknown as ReadonlyArray<McpToolDefinition>;
