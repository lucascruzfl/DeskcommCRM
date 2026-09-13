/**
 * Operações compartilhadas de criação e edição de funis.
 *
 * Rotas REST e MCP passam por este módulo para que nome, slug, posição,
 * etapas iniciais, isolamento por organização e auditoria tenham uma única
 * implementação.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import {
  ETAPAS_INICIAIS,
  posicaoEntre,
  slugDeFunil,
  updatesDePadrao,
  validarNomeDeFunil,
  type FunilEditavel,
} from "@/lib/pipelines/pipeline-editing";

type SB = SupabaseClient;

export interface DepsDeFunil {
  supabase: SB;
  organizationId: string;
  actor: Actor;
  requestId: string;
}

const COLUNAS = "id, name, slug, description, position, is_default, is_archived";

export async function lerFunis(supabase: SB, orgId: string): Promise<FunilEditavel[]> {
  const { data, error } = await supabase
    .from("crm_pipelines")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FunilEditavel[];
}

export function corpoDosFunis(funis: FunilEditavel[]) {
  return {
    pipelines: funis
      .filter((f) => !f.is_archived)
      .map((f) => ({
        id: f.id,
        name: f.name,
        slug: f.slug,
        description: f.description ?? null,
        position: f.position,
        is_default: f.is_default,
      })),
  };
}

function autorDoAudit(actor: Actor) {
  if (actor.type === "user") return { actorUserId: actor.id, metadata: { actor_type: "user" } };
  return {
    actorUserId: null,
    metadata: { actor_type: actor.type, actor_id: actor.id },
  };
}

function erroDeBanco(error: { code?: string; message: string }, requestId: string): ApiError {
  if (error.code === "23505") {
    return new ApiError(
      409,
      "state_conflict",
      undefined,
      requestId,
      "Outro funil já ocupa esse nome ou o lugar de padrão. Recarregue e tente de novo.",
    );
  }
  return new ApiError(500, "internal_error", undefined, requestId, error.message);
}

function etapasIniciais(orgId: string, pipelineId: string) {
  return ETAPAS_INICIAIS.map((etapa, i) => ({
    organization_id: orgId,
    pipeline_id: pipelineId,
    name: etapa.name,
    slug: etapa.slug,
    position: (i + 1) * 1000,
    is_won: etapa.is_won,
    is_lost: etapa.is_lost,
  }));
}

export async function criarFunil(
  deps: DepsDeFunil,
  input: { name: string; description?: string | null },
) {
  const name = input.name.trim();
  const description = input.description?.trim() || null;
  let funis: FunilEditavel[];
  try {
    funis = await lerFunis(deps.supabase, deps.organizationId);
  } catch (err) {
    throw new ApiError(500, "internal_error", undefined, deps.requestId, (err as Error).message);
  }

  const veredito = validarNomeDeFunil(name, funis, null);
  if (!veredito.ok) {
    throw new ApiError(422, "validation_error", undefined, deps.requestId, veredito.erro);
  }

  const row = {
    organization_id: deps.organizationId,
    name,
    description,
    slug: slugDeFunil(name, funis.map((f) => f.slug)),
    position: posicaoEntre(funis[funis.length - 1]?.position ?? null, null),
    is_default: funis.filter((f) => !f.is_archived).length === 0,
  };
  const { data: criado, error } = await deps.supabase
    .from("crm_pipelines")
    .insert(row)
    .select("id")
    .single();
  if (error) throw erroDeBanco(error as { code?: string; message: string }, deps.requestId);

  const pipelineId = (criado as { id: string }).id;
  const { error: etapasErr } = await deps.supabase
    .from("crm_stages")
    .insert(etapasIniciais(deps.organizationId, pipelineId));
  if (etapasErr) {
    await deps.supabase
      .from("crm_pipelines")
      .delete()
      .eq("id", pipelineId)
      .eq("organization_id", deps.organizationId);
    throw new ApiError(
      500,
      "internal_error",
      { erro: etapasErr.message },
      deps.requestId,
      `Não consegui criar as etapas de «${name}». Nada foi salvo — tente de novo.`,
    );
  }

  const autor = autorDoAudit(deps.actor);
  void audit({
    action: "pipeline.created",
    actorUserId: autor.actorUserId,
    organizationId: deps.organizationId,
    resourceType: "crm_pipeline",
    resourceId: pipelineId,
    requestId: deps.requestId,
    metadata: { ...autor.metadata, is_default: row.is_default },
  });

  return { pipelineId, ...(corpoDosFunis(await lerFunis(deps.supabase, deps.organizationId))) };
}

export interface PedidoDeEdicaoDoFunil {
  name?: string;
  description?: string | null;
  is_default?: boolean;
  depois_de?: string | null;
}

export async function atualizarFunil(
  deps: DepsDeFunil,
  input: { pipelineId: string; pedido: PedidoDeEdicaoDoFunil },
) {
  const { pipelineId, pedido } = input;
  let funis: FunilEditavel[];
  try {
    funis = await lerFunis(deps.supabase, deps.organizationId);
  } catch (err) {
    throw new ApiError(500, "internal_error", undefined, deps.requestId, (err as Error).message);
  }
  const alvo = funis.find((f) => f.id === pipelineId);
  if (!alvo) {
    throw new ApiError(404, "pipeline_not_found", undefined, deps.requestId, "Funil não encontrado.");
  }
  if (alvo.is_archived) {
    throw new ApiError(
      409,
      "state_conflict",
      undefined,
      deps.requestId,
      `O funil «${alvo.name}» foi arquivado e não está mais na sua lista. Recarregue a página.`,
    );
  }
  if (pedido.name !== undefined) {
    const veredito = validarNomeDeFunil(pedido.name, funis, pipelineId);
    if (!veredito.ok) {
      throw new ApiError(422, "validation_error", undefined, deps.requestId, veredito.erro);
    }
  }
  if (pedido.is_default === false) {
    throw new ApiError(
      422,
      "validation_error",
      undefined,
      deps.requestId,
      `«${alvo.name}» é o funil padrão e a organização precisa de um. Marque OUTRO funil como padrão.`,
    );
  }

  type Patch = { name?: string; description?: string | null; position?: number; is_default?: boolean };
  const patchDoAlvo: Patch = {};
  if (pedido.name !== undefined) patchDoAlvo.name = pedido.name.trim();
  if (pedido.description !== undefined) patchDoAlvo.description = pedido.description?.trim() || null;
  if (pedido.depois_de !== undefined) {
    const ativos = funis.filter((f) => !f.is_archived && f.id !== pipelineId);
    const i = pedido.depois_de === null ? -1 : ativos.findIndex((f) => f.id === pedido.depois_de);
    if (pedido.depois_de !== null && i < 0) {
      throw new ApiError(
        422,
        "validation_error",
        undefined,
        deps.requestId,
        "O funil escolhido como vizinho não está mais na lista. Recarregue a página.",
      );
    }
    const position = posicaoEntre(ativos[i]?.position ?? null, ativos[i + 1]?.position ?? null);
    if (!Number.isFinite(position)) {
      throw new ApiError(409, "state_conflict", undefined, deps.requestId, "A ordenação está empatada.");
    }
    patchDoAlvo.position = position;
  }

  const updates: Array<{ pipelineId: string; patch: Patch }> =
    pedido.is_default === true ? updatesDePadrao(funis, pipelineId) : [];
  if (Object.keys(patchDoAlvo).length > 0) {
    const i = updates.findIndex((u) => u.pipelineId === pipelineId);
    if (i >= 0) updates[i] = { pipelineId, patch: { ...updates[i]!.patch, ...patchDoAlvo } };
    else updates.push({ pipelineId, patch: patchDoAlvo });
  }
  if (updates.length === 0) {
    throw new ApiError(422, "validation_error", undefined, deps.requestId, "Nada para alterar.");
  }

  for (const update of updates) {
    const { error } = await deps.supabase
      .from("crm_pipelines")
      .update(update.patch)
      .eq("id", update.pipelineId)
      .eq("organization_id", deps.organizationId);
    if (error) throw erroDeBanco(error as { code?: string; message: string }, deps.requestId);
  }

  const autor = autorDoAudit(deps.actor);
  void audit({
    action: "pipeline.updated",
    actorUserId: autor.actorUserId,
    organizationId: deps.organizationId,
    resourceType: "crm_pipeline",
    resourceId: pipelineId,
    requestId: deps.requestId,
    metadata: {
      ...autor.metadata,
      changed: Object.keys(pedido).sort(),
      update_count: updates.length,
    },
  });
  return corpoDosFunis(await lerFunis(deps.supabase, deps.organizationId));
}
