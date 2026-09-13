/** Configuração compartilhada de vocabulary/settings de um pipeline. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import {
  customFieldSchema,
  pipelineConfigPatchSchema,
  type CustomFieldDef,
  type PipelineConfigPatch,
} from "@/lib/schemas/settings";

type SB = SupabaseClient;

export interface DepsDeConfiguracaoDoFunil {
  supabase: SB;
  organizationId: string;
  actor: Actor;
  requestId: string;
}

function autorDoAudit(actor: Actor) {
  if (actor.type === "user") return { actorUserId: actor.id, metadata: { actor_type: "user" } };
  return { actorUserId: null, metadata: { actor_type: actor.type, actor_id: actor.id } };
}

async function lerConfiguracao(deps: DepsDeConfiguracaoDoFunil, pipelineId: string) {
  const { data, error } = await deps.supabase
    .from("crm_pipelines")
    .select("id, vocabulary, settings")
    .eq("id", pipelineId)
    .eq("organization_id", deps.organizationId)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  if (!data) {
    throw new ApiError(404, "pipeline_not_found", undefined, deps.requestId, "Funil não encontrado.");
  }
  return data as {
    id: string;
    vocabulary: Record<string, unknown> | null;
    settings: Record<string, unknown> | null;
  };
}

export async function atualizarConfiguracaoDoFunil(
  deps: DepsDeConfiguracaoDoFunil,
  pipelineId: string,
  patch: PipelineConfigPatch,
) {
  const parsed = pipelineConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "validation_error",
      { issues: parsed.error.flatten() },
      deps.requestId,
      "Configuração do funil inválida.",
    );
  }
  const row = await lerConfiguracao(deps, pipelineId);
  const vocabulary = parsed.data.vocabulary
    ? { ...(row.vocabulary ?? {}), ...parsed.data.vocabulary }
    : (row.vocabulary ?? {});
  const settings: Record<string, unknown> = { ...(row.settings ?? {}) };
  if (parsed.data.fields !== undefined) settings.fields = parsed.data.fields;
  if (parsed.data.lost_reasons !== undefined) settings.lost_reasons = parsed.data.lost_reasons;

  const { error } = await deps.supabase
    .from("crm_pipelines")
    .update({ vocabulary, settings })
    .eq("id", pipelineId)
    .eq("organization_id", deps.organizationId);
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);

  const autor = autorDoAudit(deps.actor);
  void audit({
    action: "pipeline.config_updated",
    actorUserId: autor.actorUserId,
    organizationId: deps.organizationId,
    resourceType: "pipeline",
    resourceId: pipelineId,
    requestId: deps.requestId,
    metadata: {
      ...autor.metadata,
      vocabulary_changed: Boolean(parsed.data.vocabulary),
      fields_count: parsed.data.fields?.length ?? null,
      lost_reasons_count: parsed.data.lost_reasons?.length ?? null,
    },
  });
  return { vocabulary, settings };
}

export type OperacaoDeCampo =
  | { operation: "create"; field: CustomFieldDef }
  | { operation: "update"; fieldKey: string; field: Partial<CustomFieldDef> }
  | { operation: "reorder"; fieldKey: string; afterFieldKey: string | null }
  | { operation: "delete"; fieldKey: string };

export async function administrarCamposDoFunil(
  deps: DepsDeConfiguracaoDoFunil,
  pipelineId: string,
  operacao: OperacaoDeCampo,
) {
  const row = await lerConfiguracao(deps, pipelineId);
  const fields = camposDoFunil(row.settings);

  if (operacao.operation === "create") {
    const parsed = customFieldSchema.safeParse(operacao.field);
    if (!parsed.success) {
      throw new ApiError(422, "validation_error", { issues: parsed.error.flatten() }, deps.requestId, "Campo inválido.");
    }
    if (fields.some((field) => field.key === parsed.data.key)) {
      throw new ApiError(409, "validation_error", undefined, deps.requestId, "Já existe um campo com essa chave.");
    }
    fields.push(parsed.data);
  } else {
    const index = fields.findIndex((field) => field.key === operacao.fieldKey);
    if (index < 0) {
      throw new ApiError(404, "field_not_found", undefined, deps.requestId, "Campo não encontrado.");
    }
    if (operacao.operation === "update") {
      const parsed = customFieldSchema.safeParse({ ...fields[index], ...operacao.field });
      if (!parsed.success) {
        throw new ApiError(422, "validation_error", { issues: parsed.error.flatten() }, deps.requestId, "Campo inválido.");
      }
      if (fields.some((field, i) => i !== index && field.key === parsed.data.key)) {
        throw new ApiError(409, "validation_error", undefined, deps.requestId, "Já existe um campo com essa chave.");
      }
      fields[index] = parsed.data;
    } else if (operacao.operation === "delete") {
      fields.splice(index, 1);
    } else {
      const [field] = fields.splice(index, 1);
      const after = operacao.afterFieldKey === null
        ? -1
        : fields.findIndex((candidate) => candidate.key === operacao.afterFieldKey);
      if (operacao.afterFieldKey !== null && after < 0) {
        throw new ApiError(422, "invalid_stage_order", undefined, deps.requestId, "Campo vizinho não encontrado.");
      }
      fields.splice(after + 1, 0, field!);
    }
  }

  await atualizarConfiguracaoDoFunil(deps, pipelineId, { fields });
  return { fields };
}
