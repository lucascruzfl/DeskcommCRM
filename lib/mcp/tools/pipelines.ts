/**
 * MCP read tool — crm_list_pipelines (Spec 11 §3.1).
 */
import { z } from "zod";

import { listPipelinesHandler } from "@/app/api/v1/pipelines/_handler";
import { carregarPrevisao } from "@/lib/leads/previsao";
import type { McpToolDefinition } from "../types";
import {
  arquivarPipeline,
  atualizarConfiguracaoDoPipeline,
  atualizarPipeline,
  criarPipeline,
  obterPipeline,
  obterPipelineOperacional,
} from "@/lib/pipelines/operations";
import { pipelineConfigPatchSchema } from "@/lib/schemas/settings";
import { canAccessManagedArea } from "@/lib/managed-clients/policy";

function operationContext(ctx: Parameters<typeof obterPipeline>[0]) {
  return ctx;
}

const listInputShape = {
  include_archived: z.boolean().optional().default(false),
};

const getPipelineShape = { pipeline_id: z.string().uuid() };

export const crmGetPipeline: McpToolDefinition<typeof getPipelineShape> = {
  name: "crm_get_pipeline",
  description:
    "Consulta um funil completo pelo UUID, incluindo configuração, vocabulário, campos personalizados, motivos de perda e todas as etapas na ordem do Kanban.",
  inputSchema: getPipelineShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "pipelines",
  handler: (input, ctx) => {
    const operation = operationContext({
      supabase: ctx.supabase,
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      requestId: ctx.requestId,
      apiTokenId: ctx.apiTokenId,
    });
    return ctx.managedPolicy &&
      !canAccessManagedArea(ctx.managedPolicy, ctx.role, "/app/settings/tenant/pipelines")
      ? obterPipelineOperacional(operation, input.pipeline_id)
      : obterPipeline(operation, input.pipeline_id);
  },
};

const createPipelineShape = {
  name: z.string().min(1).max(80),
  description: z.string().max(280).nullable().optional(),
};

export const crmCreatePipeline: McpToolDefinition<typeof createPipelineShape> = {
  name: "crm_create_pipeline",
  description:
    "Cria um funil com as etapas iniciais oficiais Novo, Em andamento, Ganho e Perdido. O slug, a ordem e a marca de padrão do primeiro funil são calculados pelo serviço canônico.",
  inputSchema: createPipelineShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "pipelines",
  auditResource: (_input, result) => ({
    type: "crm_pipeline",
    id: (result as { id?: string } | undefined)?.id,
  }),
  handler: (input, ctx) =>
    criarPipeline(
      {
        supabase: ctx.supabase,
        organizationId: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
        apiTokenId: ctx.apiTokenId,
      },
      input,
    ),
};

const updatePipelineShape = {
  pipeline_id: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).nullable().optional(),
  is_default: z.literal(true).optional(),
  is_client_pipeline: z.boolean().optional(),
  is_archived: z.literal(false).optional(),
  after_pipeline_id: z.string().uuid().nullable().optional(),
};

export const crmUpdatePipeline: McpToolDefinition<typeof updatePipelineShape> = {
  name: "crm_update_pipeline",
  description:
    "Renomeia, descreve, reordena, define como padrão ou tira um funil do arquivo. Para arquivar use crm_archive_pipeline; is_default só aceita true porque a organização precisa manter um funil padrão.",
  inputSchema: updatePipelineShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "pipelines",
  auditResource: (input) => ({ type: "crm_pipeline", id: input.pipeline_id }),
  handler: (input, ctx) => {
    const { pipeline_id, ...patch } = input;
    return atualizarPipeline(
      {
        supabase: ctx.supabase,
        organizationId: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
        apiTokenId: ctx.apiTokenId,
      },
      pipeline_id,
      patch,
    );
  },
};

const archivePipelineShape = { pipeline_id: z.string().uuid() };

export const crmArchivePipeline: McpToolDefinition<typeof archivePipelineShape> = {
  name: "crm_archive_pipeline",
  description:
    "Arquiva um funil sem apagar o histórico. Recusa o único funil ativo, o padrão e funis ainda usados por entradas automáticas ou automações; negócios existentes são preservados.",
  inputSchema: archivePipelineShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "pipelines",
  capabilities: ["destructive_operations"],
  auditResource: (input) => ({ type: "crm_pipeline", id: input.pipeline_id }),
  handler: (input, ctx) =>
    arquivarPipeline(
      {
        supabase: ctx.supabase,
        organizationId: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
        apiTokenId: ctx.apiTokenId,
      },
      input.pipeline_id,
    ),
};

const configPipelineShape = {
  pipeline_id: z.string().uuid(),
  ...pipelineConfigPatchSchema.shape,
};

export const crmUpdatePipelineSchema: McpToolDefinition<typeof configPipelineShape> = {
  name: "crm_update_pipeline_schema",
  description:
    "Substitui as definições reais de campos personalizados e motivos de perda, ou atualiza o vocabulário do funil. Envie a lista completa de fields; valores já gravados nos leads não são apagados.",
  inputSchema: configPipelineShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "pipelines",
  auditResource: (input) => ({ type: "crm_pipeline", id: input.pipeline_id }),
  handler: (input, ctx) => {
    const { pipeline_id, ...patch } = input;
    return atualizarConfiguracaoDoPipeline(
      {
        supabase: ctx.supabase,
        organizationId: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
        apiTokenId: ctx.apiTokenId,
      },
      pipeline_id,
      patch,
    );
  },
};

export const crmListPipelines: McpToolDefinition<typeof listInputShape> = {
  name: "crm_list_pipelines",
  description:
    "Lista pipelines do CRM com seus stages (vocabulary inclusa para renomear lead/deal/won/lost por tenant).",
  inputSchema: listInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "pipelines",
  handler: async (input, ctx) => {
    if (
      ctx.managedPolicy &&
      !canAccessManagedArea(ctx.managedPolicy, ctx.role, "/app/settings/tenant/pipelines")
    ) {
      let query = ctx.supabase
        .from("operational_crm_pipelines")
        .select("id, organization_id, name, slug, description, is_default, is_archived, position")
        .eq("organization_id", ctx.organizationId)
        .order("position", { ascending: true });
      if (!input.include_archived) query = query.eq("is_archived", false);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { pipelines: data ?? [] };
    }
    const result = await listPipelinesHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      { include_archived: input.include_archived },
    );
    const onlyOrg = result.pipelines.filter((p) => p.organization_id === ctx.organizationId);
    return {
      pipelines: onlyOrg.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        is_default: p.is_default,
        is_archived: p.is_archived,
        position: p.position,
        vocabulary: p.vocabulary,
      })),
    };
  },
};

const forecastInputShape = {
  pipeline_id: z.string().uuid(),
};

/**
 * A previsão ponderada de UM funil (issue #1535) — a MESMA regra da rota REST
 * `GET /api/v1/pipelines/[id]/forecast`, porque duas réguas para a mesma conta
 * divergem no primeiro ajuste de probabilidade.
 *
 * ⚠️ AQUI O CLIENTE É O DO CONTEXTO (service-role, bypassa RLS), então o
 * isolamento vem do filtro explícito de `organization_id` dentro de
 * `carregarPrevisao`. A rota REST usa o client de SESSÃO de propósito: é ela
 * que tem de respeitar `visibility_mode = "own"` (migration 0036) para um
 * atendente ver só a previsão dos próprios negócios.
 */
export const crmGetPipelineForecast: McpToolDefinition<typeof forecastInputShape> = {
  name: "crm_get_pipeline_forecast",
  description:
    "Devolve a previsão ponderada de um funil: negócios ABERTOS agrupados por moeda e por mês de " +
    "expected_close_date, com bruto_cents e ponderado_cents (valor x probabilidade), mais os baldes " +
    '"sem data" e "sem probabilidade" reportados À PARTE — nunca somados como zero. A fonte da ' +
    'probabilidade vem de crm_pipelines.settings.previsao.fonte: "etapa" (padrão) ou ' +
    '"ia_quando_houver" (usa crm_lead_scores.ai_probability quando existe). Moedas diferentes ' +
    "NUNCA são somadas entre si.",
  inputSchema: forecastInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) =>
    carregarPrevisao(ctx.supabase, {
      organizationId: ctx.organizationId,
      pipelineId: input.pipeline_id,
      requestId: ctx.requestId,
    }),
};
