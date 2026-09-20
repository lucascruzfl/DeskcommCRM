import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { lerDependencias, lerFunis } from "@/app/api/v1/pipelines/_funis";
import {
  ETAPAS_INICIAIS,
  posicaoEntre,
  slugDeFunil,
  updatesDeMarcaExclusiva,
  updatesDePadrao,
  validarArquivamento,
  validarNomeDeFunil,
} from "@/lib/pipelines/pipeline-editing";
import { pipelineConfigPatchSchema, type PipelineConfigPatch } from "@/lib/schemas/settings";

export interface PipelineOperationContext {
  supabase: SupabaseClient;
  organizationId: string;
  actor: Actor;
  requestId: string;
  apiTokenId?: string;
}

function actorAudit(ctx: PipelineOperationContext) {
  return ctx.actor.type === "user"
    ? { actorUserId: ctx.actor.id, actorApiTokenId: null, metadata: { actor_type: "user" } }
    : {
        actorUserId: null,
        actorApiTokenId: ctx.apiTokenId ?? (ctx.actor.type === "api_token" ? ctx.actor.id : null),
        metadata: { actor_type: ctx.actor.type, actor_id: ctx.actor.id, via: "mcp" },
      };
}

export async function obterPipeline(ctx: PipelineOperationContext, pipelineId: string) {
  const { data, error } = await ctx.supabase.from("crm_pipelines").select("*")
    .eq("organization_id", ctx.organizationId).eq("id", pipelineId).maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  if (!data) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Funil não encontrado.");
  const { data: stages, error: stagesError } = await ctx.supabase.from("crm_stages").select("*")
    .eq("organization_id", ctx.organizationId).eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });
  if (stagesError) throw new ApiError(500, "internal_error", undefined, ctx.requestId, stagesError.message);
  return { ...data, stages: stages ?? [] };
}

export async function criarPipeline(
  ctx: PipelineOperationContext,
  input: { name: string; description?: string | null },
) {
  const funis = await lerFunis(ctx.supabase, ctx.organizationId);
  const name = input.name.trim();
  const veredito = validarNomeDeFunil(name, funis, null);
  if (!veredito.ok) throw new ApiError(422, "unprocessable_entity", undefined, ctx.requestId, veredito.erro);
  const row = {
    organization_id: ctx.organizationId,
    name,
    description: input.description?.trim() || null,
    slug: slugDeFunil(name, funis.map((f) => f.slug)),
    position: posicaoEntre(funis.at(-1)?.position ?? null, null),
    is_default: funis.filter((f) => !f.is_archived).length === 0,
  };
  const { data, error } = await ctx.supabase.from("crm_pipelines").insert(row).select("id").single();
  if (error || !data) throw new ApiError(error?.code === "23505" ? 409 : 500, error?.code === "23505" ? "state_conflict" : "internal_error", undefined, ctx.requestId, error?.message);
  const pipelineId = String(data.id);
  const { error: stagesError } = await ctx.supabase.from("crm_stages").insert(ETAPAS_INICIAIS.map((s, index) => ({
    organization_id: ctx.organizationId, pipeline_id: pipelineId, name: s.name, slug: s.slug,
    position: (index + 1) * 1000, is_won: s.is_won, is_lost: s.is_lost,
  })));
  if (stagesError) {
    await ctx.supabase.from("crm_pipelines").delete().eq("organization_id", ctx.organizationId).eq("id", pipelineId);
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, stagesError.message);
  }
  const a = actorAudit(ctx);
  await audit({ action: "pipeline.created", organizationId: ctx.organizationId, actorUserId: a.actorUserId,
    actorApiTokenId: a.actorApiTokenId, resourceType: "crm_pipeline", resourceId: pipelineId,
    requestId: ctx.requestId, metadata: { ...a.metadata, name, slug: row.slug, is_default: row.is_default } });
  return obterPipeline(ctx, pipelineId);
}

export interface AtualizarPipelineInput {
  name?: string;
  description?: string | null;
  is_default?: true;
  is_client_pipeline?: boolean;
  is_archived?: false;
  after_pipeline_id?: string | null;
}

export async function atualizarPipeline(ctx: PipelineOperationContext, pipelineId: string, input: AtualizarPipelineInput) {
  const funis = await lerFunis(ctx.supabase, ctx.organizationId);
  const alvo = funis.find((f) => f.id === pipelineId);
  if (!alvo) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Funil não encontrado.");
  if (alvo.is_archived && input.is_archived !== false) throw new ApiError(409, "state_conflict", undefined, ctx.requestId, "Tire o funil do arquivo antes de editá-lo.");
  if (alvo.is_archived && input.is_archived === false && Object.values(input).filter((value) => value !== undefined).length > 1) {
    throw new ApiError(409, "state_conflict", undefined, ctx.requestId, "Tire o funil do arquivo antes de editar outros campos.");
  }
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    const verdict = validarNomeDeFunil(name, funis, pipelineId);
    if (!verdict.ok) throw new ApiError(422, "unprocessable_entity", undefined, ctx.requestId, verdict.erro);
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.is_archived === false && alvo.is_archived) patch.is_archived = false;
  if (input.after_pipeline_id !== undefined) {
    const ativos = funis.filter((f) => !f.is_archived && f.id !== pipelineId);
    const index = input.after_pipeline_id === null ? -1 : ativos.findIndex((f) => f.id === input.after_pipeline_id);
    if (input.after_pipeline_id !== null && index < 0) throw new ApiError(422, "unprocessable_entity", undefined, ctx.requestId, "Funil vizinho não encontrado nesta organização.");
    const position = posicaoEntre(ativos[index]?.position ?? null, ativos[index + 1]?.position ?? null);
    if (!Number.isFinite(position)) throw new ApiError(409, "state_conflict", undefined, ctx.requestId, "A ordenação precisa ser recarregada.");
    patch.position = position;
  }
  const updates: Array<{ pipelineId: string; patch: Record<string, unknown> }> = input.is_default
    ? updatesDePadrao(funis, pipelineId)
    : input.is_client_pipeline === true
      ? updatesDeMarcaExclusiva(funis, pipelineId, "is_client_pipeline")
      : [];
  if (input.is_client_pipeline === false) patch.is_client_pipeline = false;
  if (Object.keys(patch).length) {
    const found = updates.find((u) => u.pipelineId === pipelineId);
    if (found) Object.assign(found.patch, patch); else updates.push({ pipelineId, patch });
  }
  if (!updates.length) throw new ApiError(422, "unprocessable_entity", undefined, ctx.requestId, "Nada para alterar.");
  for (const update of updates) {
    const { error } = await ctx.supabase.from("crm_pipelines").update(update.patch)
      .eq("organization_id", ctx.organizationId).eq("id", update.pipelineId);
    if (error) throw new ApiError(error.code === "23505" ? 409 : 500, error.code === "23505" ? "state_conflict" : "internal_error", undefined, ctx.requestId, error.message);
  }
  const a = actorAudit(ctx);
  await audit({ action: input.is_archived === false ? "pipeline.unarchived" : "pipeline.updated",
    organizationId: ctx.organizationId, actorUserId: a.actorUserId, actorApiTokenId: a.actorApiTokenId,
    resourceType: "crm_pipeline", resourceId: pipelineId, requestId: ctx.requestId,
    metadata: { ...a.metadata, fields: Object.keys(input) } });
  return obterPipeline(ctx, pipelineId);
}

export async function arquivarPipeline(ctx: PipelineOperationContext, pipelineId: string) {
  const funis = await lerFunis(ctx.supabase, ctx.organizationId);
  const alvo = funis.find((f) => f.id === pipelineId);
  if (!alvo) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Funil não encontrado.");
  const deps = await lerDependencias(ctx.supabase, ctx.organizationId, pipelineId);
  const verdict = validarArquivamento(funis, pipelineId, deps);
  if (!verdict.ok) throw new ApiError(422, "unprocessable_entity", { dependencies: deps }, ctx.requestId, verdict.erro);
  const { error } = await ctx.supabase.from("crm_pipelines").update({ is_archived: true })
    .eq("organization_id", ctx.organizationId).eq("id", pipelineId);
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  const a = actorAudit(ctx);
  await audit({ action: "pipeline.archived", organizationId: ctx.organizationId, actorUserId: a.actorUserId,
    actorApiTokenId: a.actorApiTokenId, resourceType: "crm_pipeline", resourceId: pipelineId,
    requestId: ctx.requestId, metadata: { ...a.metadata, name: alvo.name, leads: deps.negocios } });
  return { pipeline_id: pipelineId, archived: true };
}

export async function atualizarConfiguracaoDoPipeline(
  ctx: PipelineOperationContext,
  pipelineId: string,
  rawPatch: PipelineConfigPatch,
) {
  const patch = pipelineConfigPatchSchema.parse(rawPatch);
  const { data: row, error: readError } = await ctx.supabase.from("crm_pipelines")
    .select("vocabulary, settings").eq("organization_id", ctx.organizationId).eq("id", pipelineId).maybeSingle();
  if (readError) throw new ApiError(500, "internal_error", undefined, ctx.requestId, readError.message);
  if (!row) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Funil não encontrado.");
  const vocabulary = patch.vocabulary ? { ...((row.vocabulary as Record<string, unknown> | null) ?? {}), ...patch.vocabulary } : row.vocabulary;
  const settings = { ...((row.settings as Record<string, unknown> | null) ?? {}) };
  if (patch.fields !== undefined) settings.fields = patch.fields;
  if (patch.lost_reasons !== undefined) settings.lost_reasons = patch.lost_reasons;
  const { error } = await ctx.supabase.from("crm_pipelines").update({ vocabulary, settings })
    .eq("organization_id", ctx.organizationId).eq("id", pipelineId);
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  const a = actorAudit(ctx);
  await audit({ action: "pipeline.config_updated", organizationId: ctx.organizationId, actorUserId: a.actorUserId,
    actorApiTokenId: a.actorApiTokenId, resourceType: "pipeline", resourceId: pipelineId,
    requestId: ctx.requestId, metadata: { ...a.metadata, vocabulary_changed: !!patch.vocabulary,
      fields_count: patch.fields?.length ?? null, lost_reasons_count: patch.lost_reasons?.length ?? null } });
  return obterPipeline(ctx, pipelineId);
}
