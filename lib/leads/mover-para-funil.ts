import type { SupabaseClient } from "@supabase/supabase-js";

import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import {
  FUNIL_DE_DESTINO_NAO_ENCONTRADO,
  ORIGEM_SEM_ETAPA_DE_PERDA,
  escolheEtapaDeDestino,
  montaPayloadDoClone,
  recusaTrocaDeFunil,
  registroDoDestino,
  type EtapaDoFunil,
  type OrigemParaClonar,
} from "@/lib/leads/clonar-para-funil";
import { encerraDemanda } from "@/lib/leads/encerramento";
import {
  motivoDaPerdaDaOrigem,
  recusaDeMotivoForaDoVocabulario,
} from "@/lib/leads/motivo-da-perda";
import type { CloneLeadInput } from "@/lib/schemas/leads";

function atorDaAuditoria(ctx: HandlerCtx) {
  if (ctx.actor.type === "user") {
    return { actorUserId: ctx.actor.id, actorApiTokenId: null };
  }
  if (ctx.actor.type === "api_token") {
    return { actorUserId: null, actorApiTokenId: ctx.actor.id };
  }
  if (ctx.actor.type === "ai_agent") {
    return { actorUserId: null, actorApiTokenId: ctx.actor.api_token_id ?? null };
  }
  return { actorUserId: null, actorApiTokenId: null };
}

function erro(status: number, code: string, message: string, ctx: HandlerCtx): never {
  throw new ApiError(status, code, undefined, ctx.requestId, message);
}

/**
 * Leva um negócio aberto para outro funil pela regra oficial P-01.
 *
 * A operação cria o sucessor antes de encerrar a origem. Assim, uma falha parcial
 * nunca deixa o negócio perdido sem destino visível. O sucessor nasce pelo mesmo
 * handler de criação usado pela UI, e o encerramento passa por `encerraDemanda`,
 * preservando eventos, automações e as duas linhas de timeline.
 */
export async function moverLeadParaOutroFunil(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  leadId: string,
  input: CloneLeadInput,
) {
  const idioma = ctx.idioma ?? "pt-BR";
  const t = (texto: string) => traduzir(texto, idioma);
  const { data: origem, error: selErr } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("id", leadId)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();
  if (selErr) erro(500, "internal_error", selErr.message, ctx);
  if (!origem) erro(404, "not_found", t("Lead não encontrado."), ctx);

  const { data: pipelineDestino, error: pipeErr } = await supabase
    .from("crm_pipelines")
    .select("id, name")
    .eq("id", input.pipeline_id)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();
  if (pipeErr) erro(500, "internal_error", pipeErr.message, ctx);
  if (!pipelineDestino) {
    erro(404, "pipeline_not_found", t(FUNIL_DE_DESTINO_NAO_ENCONTRADO), ctx);
  }

  const origemTipada = origem as OrigemParaClonar;
  const recusa = recusaTrocaDeFunil(origemTipada, input.pipeline_id);
  if (recusa) erro(recusa.status, recusa.code, t(recusa.texto), ctx);

  const { data: pipelineOrigem, error: origemPipeErr } = await supabase
    .from("crm_pipelines")
    .select("settings, name")
    .eq("id", origemTipada.pipeline_id)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();
  if (origemPipeErr) erro(500, "internal_error", origemPipeErr.message, ctx);

  const motivoRecusado = recusaDeMotivoForaDoVocabulario({
    motivo: input.lost_reason,
    settingsDoFunil: (pipelineOrigem as { settings?: unknown } | null)?.settings ?? null,
    idioma,
  });
  if (motivoRecusado) erro(422, motivoRecusado.codigo, motivoRecusado.mensagem, ctx);

  const { data: etapas, error: stagesErr } = await supabase
    .from("crm_stages")
    .select("id, pipeline_id, position, is_won, is_lost, is_archived")
    .eq("organization_id", ctx.organization_id)
    .eq("pipeline_id", input.pipeline_id)
    .eq("is_archived", false)
    .order("position", { ascending: true });
  if (stagesErr) erro(500, "internal_error", stagesErr.message, ctx);

  const destino = escolheEtapaDeDestino(
    (etapas ?? []) as EtapaDoFunil[],
    input.stage_id ?? null,
  );
  if (!destino.ok) erro(destino.status, destino.code, t(destino.texto), ctx);

  const { data: etapaDePerdaDaOrigem, error: perdaErr } = await supabase
    .from("crm_stages")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("pipeline_id", origemTipada.pipeline_id)
    .eq("is_lost", true)
    .eq("is_archived", false)
    .limit(1)
    .maybeSingle();
  if (perdaErr) erro(500, "internal_error", perdaErr.message, ctx);
  if (!etapaDePerdaDaOrigem) {
    erro(422, "pipeline_no_lost_stage", t(ORIGEM_SEM_ETAPA_DE_PERDA), ctx);
  }

  const clone = await createLeadHandler(
    supabase,
    ctx,
    montaPayloadDoClone(origemTipada, destino.etapa),
  );
  const destination = registroDoDestino(clone);
  const nomeDoFunilDeOrigem = (pipelineOrigem as { name?: string | null } | null)?.name ?? null;
  const nomeDoFunilDeDestino = (pipelineDestino as { name?: string | null }).name ?? null;

  const atividadeDoClone = await emitLeadActivity(supabase, {
    organizationId: ctx.organization_id,
    leadId: String(destination.lead_id),
    contactId: origemTipada.contact_id ?? null,
    type: "moved_from_pipeline",
    sourceModule: "crm",
    sourceId: leadId,
    actor: ctx.actor,
    reason: nomeDoFunilDeOrigem ? `Veio do funil ${nomeDoFunilDeOrigem}` : "Veio de outro funil",
    payload: { from_pipeline_id: origemTipada.pipeline_id, from_lead_id: leadId },
  });
  if (!atividadeDoClone.ok) {
    await registraFalhaDeAtividade(supabase, {
      organizationId: ctx.organization_id,
      leadId: String(destination.lead_id),
      tipo: "moved_from_pipeline",
      origem: "lib/leads/mover-para-funil",
      erro: atividadeDoClone.error,
      requestId: ctx.requestId,
    });
  }

  const motivo = motivoDaPerdaDaOrigem(input.lost_reason);
  const { lead: origemEncerrada } = await encerraDemanda(supabase, ctx, {
    leadId,
    desfecho: "lost",
    motivo,
    razaoNaTimeline: nomeDoFunilDeDestino
      ? `Levado para o funil ${nomeDoFunilDeDestino}`
      : "Levado para outro funil",
    payloadNaTimeline: {
      to_pipeline_id: input.pipeline_id,
      to_lead_id: destination.lead_id,
    },
  });

  const sourceMetadata = {
    ...(origemTipada.source_metadata ?? {}),
    movido_para: destination,
  };
  const { data: origemFinal, error: updErr } = await supabase
    .from("crm_leads")
    .update({ source_metadata: sourceMetadata, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("organization_id", ctx.organization_id)
    .select("*")
    .maybeSingle();
  if (updErr) erro(500, "internal_error", updErr.message, ctx);

  const ator = atorDaAuditoria(ctx);
  await audit({
    action: "lead.moved_to_pipeline",
    actorUserId: ator.actorUserId,
    actorApiTokenId: ator.actorApiTokenId,
    organizationId: ctx.organization_id,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId: ctx.requestId,
    metadata: {
      actor_type: ctx.actor.type,
      from_pipeline_id: origemTipada.pipeline_id,
      to_pipeline_id: input.pipeline_id,
      to_stage_id: destino.etapa.id,
      cloned_lead_id: destination.lead_id,
      lost_reason: motivo,
    },
  });

  return { lead: clone, origem: origemFinal ?? origemEncerrada };
}
