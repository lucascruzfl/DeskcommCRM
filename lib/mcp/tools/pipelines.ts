/** Tools MCP de leitura e administração de pipelines. */
import { z } from "zod";

import { listPipelinesHandler } from "@/app/api/v1/pipelines/_handler";
import { ApiError } from "@/lib/api/types";
import {
  arquivarEtapa,
  atualizarEtapa,
  criarEtapa,
} from "@/lib/leads/stage-operations";
import {
  administrarCamposDoFunil,
  type OperacaoDeCampo,
} from "@/lib/pipelines/pipeline-config-operations";
import { atualizarFunil, criarFunil } from "@/lib/pipelines/pipeline-operations";
import { customFieldSchema } from "@/lib/schemas/settings";
import type { McpToolDefinition } from "../types";
import type { McpContext } from "../types";

function deps(ctx: McpContext) {
  return {
    supabase: ctx.supabase,
    organizationId: ctx.organizationId,
    actor: ctx.actor,
    requestId: ctx.requestId,
  };
}

const listInputShape = {
  include_archived: z.boolean().optional().default(false),
};

export const crmListPipelines: McpToolDefinition<typeof listInputShape> = {
  name: "crm_list_pipelines",
  description:
    "Lista pipelines do CRM com seus stages (vocabulary inclusa para renomear lead/deal/won/lost por tenant).",
  inputSchema: listInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
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

const createPipelineShape = {
  name: z.string().min(1).max(80),
  description: z.string().max(280).nullable().optional(),
};

export const crmCreatePipeline: McpToolDefinition<typeof createPipelineShape> = {
  name: "crm_create_pipeline",
  description:
    "Cria um pipeline na organização do token com as quatro etapas seguras do produto (Novo, Em andamento, Ganho e Perdido). " +
    "Depois personalize etapas e campos com crm_manage_pipeline_stages e crm_manage_pipeline_fields.",
  inputSchema: createPipelineShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const result = await criarFunil(deps(ctx), input);
    return { pipeline_id: result.pipelineId, pipelines: result.pipelines };
  },
};

const updatePipelineShape = {
  pipeline_id: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).nullable().optional(),
};

export const crmUpdatePipeline: McpToolDefinition<typeof updatePipelineShape> = {
  name: "crm_update_pipeline",
  description: "Atualiza somente name e description de um pipeline ativo da organização do token.",
  inputSchema: updatePipelineShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const pedido: { name?: string; description?: string | null } = {};
    if (input.name !== undefined) pedido.name = input.name;
    if (input.description !== undefined) pedido.description = input.description;
    if (Object.keys(pedido).length === 0) {
      throw new ApiError(422, "validation_error", undefined, ctx.requestId, "Nada para alterar.");
    }
    return atualizarFunil(deps(ctx), { pipelineId: input.pipeline_id, pedido });
  },
};

const manageStagesShape = {
  pipeline_id: z.string().uuid(),
  operation: z.enum(["create", "update", "reorder", "archive"]),
  stage_id: z.string().uuid().optional(),
  name: z.string().min(1).max(80).optional(),
  is_won: z.boolean().optional(),
  is_lost: z.boolean().optional(),
  after_stage_id: z.string().uuid().nullable().optional(),
  move_leads_to_stage_id: z.string().uuid().nullable().optional(),
};

export const crmManagePipelineStages: McpToolDefinition<typeof manageStagesShape> = {
  name: "crm_manage_pipeline_stages",
  description:
    "Administra etapas por IDs reais. operation=create exige name; update exige stage_id e algum de name/is_won/is_lost; " +
    "reorder exige stage_id e after_stage_id (null = primeira); archive exige stage_id e move_leads_to_stage_id se houver leads. " +
    "O servidor preserva as regras de ganho/perda e move leads antes de arquivar.",
  inputSchema: manageStagesShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const d = deps(ctx);
    if (input.operation === "create") {
      if (!input.name) throw new ApiError(422, "validation_error", undefined, ctx.requestId, "name é obrigatório.");
      const result = await criarEtapa(d, { pipelineId: input.pipeline_id, nome: input.name });
      return { operation: input.operation, stage_id: result.stageId, ...result.funil };
    }
    if (!input.stage_id) {
      throw new ApiError(422, "validation_error", undefined, ctx.requestId, "stage_id é obrigatório.");
    }
    if (input.operation === "archive") {
      const result = await arquivarEtapa(d, {
        pipelineId: input.pipeline_id,
        stageId: input.stage_id,
        destinoId: input.move_leads_to_stage_id ?? null,
      });
      return { operation: input.operation, leads_moved: result.negociosMovidos, ...result.funil };
    }
    if (input.operation === "reorder") {
      if (input.after_stage_id === undefined) {
        throw new ApiError(422, "invalid_stage_order", undefined, ctx.requestId, "after_stage_id é obrigatório.");
      }
      const result = await atualizarEtapa(d, {
        pipelineId: input.pipeline_id,
        stageId: input.stage_id,
        pedido: { depois_de: input.after_stage_id },
      });
      return { operation: input.operation, ...result.funil };
    }
    const pedido: { name?: string; is_won?: boolean; is_lost?: boolean } = {};
    if (input.name !== undefined) pedido.name = input.name;
    if (input.is_won !== undefined) pedido.is_won = input.is_won;
    if (input.is_lost !== undefined) pedido.is_lost = input.is_lost;
    if (Object.keys(pedido).length === 0) {
      throw new ApiError(422, "validation_error", undefined, ctx.requestId, "Nada para alterar na etapa.");
    }
    const result = await atualizarEtapa(d, {
      pipelineId: input.pipeline_id,
      stageId: input.stage_id,
      pedido,
    });
    return { operation: input.operation, ...result.funil };
  },
};

const manageFieldsShape = {
  pipeline_id: z.string().uuid(),
  operation: z.enum(["create", "update", "reorder", "delete"]),
  field_key: z.string().min(1).max(40).optional(),
  field: customFieldSchema.partial().optional(),
  after_field_key: z.string().min(1).max(40).nullable().optional(),
};

export const crmManagePipelineFields: McpToolDefinition<typeof manageFieldsShape> = {
  name: "crm_manage_pipeline_fields",
  description:
    "Administra os campos personalizados declarados em pipeline.settings.fields. Os tipos aceitos são exatamente os do CRM. " +
    "operation=create exige field completo; update exige field_key e field parcial; reorder exige field_key e after_field_key; " +
    "delete remove a definição, mas preserva os valores históricos já gravados nos leads.",
  inputSchema: manageFieldsShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    let operation: OperacaoDeCampo;
    if (input.operation === "create") {
      const parsed = customFieldSchema.safeParse(input.field);
      if (!parsed.success) {
        throw new ApiError(422, "validation_error", { issues: parsed.error.flatten() }, ctx.requestId, "field completo é obrigatório.");
      }
      operation = { operation: "create", field: parsed.data };
    } else {
      if (!input.field_key) {
        throw new ApiError(422, "validation_error", undefined, ctx.requestId, "field_key é obrigatório.");
      }
      if (input.operation === "update") {
        if (!input.field || Object.keys(input.field).length === 0) {
          throw new ApiError(422, "validation_error", undefined, ctx.requestId, "field parcial é obrigatório.");
        }
        operation = { operation: "update", fieldKey: input.field_key, field: input.field };
      } else if (input.operation === "reorder") {
        if (input.after_field_key === undefined) {
          throw new ApiError(422, "validation_error", undefined, ctx.requestId, "after_field_key é obrigatório.");
        }
        operation = { operation: "reorder", fieldKey: input.field_key, afterFieldKey: input.after_field_key };
      } else {
        operation = { operation: "delete", fieldKey: input.field_key };
      }
    }
    const result = await administrarCamposDoFunil(deps(ctx), input.pipeline_id, operation);
    return { operation: input.operation, ...result };
  },
};
