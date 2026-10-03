import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { proposalAuditActor } from "@/lib/propostas/administracao-audit";
/**
 * POST /api/v1/proposals/[id]/revise — D4. Cria a v2 em RASCUNHO a partir de
 * uma proposta ENVIADA: copia titulo/condicoes/valid_until/itens, herda
 * numero/ano, aponta substitui_id para a v1. A v1 CONTINUA `enviada` — só
 * vira `substituida` quando a v2 for efetivamente enviada
 * (app/api/v1/proposals/[id]/send/route.ts).
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { resolverItensDaProposta } from "@/lib/propostas/itens";
import { decidirRevisao } from "@/lib/propostas/versao";
import { traduzir } from "@/lib/i18n/dicionario";

export const revisionCreateSchema = z.object({ motivo: z.string().max(1000).optional() });
export async function createProposalRevisionHandler(
  admin: SupabaseClient,
  ctx: HandlerCtx,
  id: string,
  motivo: string | null,
) {
  const requestId = ctx.requestId;
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  const { data: proposta } = await admin
    .from("crm_proposals")
    .select("*")
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (!proposta)
    throw new ApiError(404, "not_found", undefined, requestId, t("Proposta não encontrada."));

  let decisao;
  try {
    decisao = decidirRevisao(proposta as never);
  } catch {
    throw new ApiError(
      409,
      "proposal_context_stale",
      undefined,
      requestId,
      t("Esta proposta não pode ser revisada neste estado."),
    );
  }

  const { data: itensDaV1 } = await admin
    .from("crm_proposal_items")
    .select("*")
    .eq("organization_id", ctx.organization_id)
    .eq("proposal_id", id)
    .order("position");

  // Achado Importante da revisão C4: copiar `preco_unitario_cents` da v1 sem
  // passar pelo resolvedor único (C3, D5) reintroduzia a mesma classe de bug
  // que a C3 fechou — preço congelado do momento da v1, em vez do preço
  // ATUAL do catálogo. Resolve de novo aqui, igual a toda outra escrita de
  // itens de proposta (criação, PATCH, ferramenta da IA).
  const resolvido = await resolverItensDaProposta(
    admin,
    ctx.organization_id,
    (itensDaV1 ?? []).map((it) => ({
      product_id: it.product_id,
      descricao: it.descricao,
      quantidade: it.quantidade,
      preco_unitario_cents: it.preco_unitario_cents,
      desconto_cents: it.desconto_cents,
      position: it.position,
    })),
    // D11 — a v2 herda a moeda da v1 (já gravada no INSERT abaixo); item
    // cujo produto mudou de moeda no catálogo desde a v1 é recusado aqui.
    proposta.moeda,
  );
  if (!resolvido.ok) {
    throw new ApiError(422, "validation_failed", undefined, requestId, t(resolvido.motivo));
  }

  // §5.3 — a v2 conta como "o" rascunho aberto do negócio. Se por algum
  // motivo já houver outro rascunho aberto (de uma cadeia diferente), o
  // índice único do banco recusa — capturado abaixo como 23505.
  const { data: nova, error: novaErr } = await admin
    .from("crm_proposals")
    .insert({
      organization_id: ctx.organization_id,
      lead_id: proposta.lead_id,
      contact_id: proposta.contact_id,
      conversation_id: proposta.conversation_id,
      titulo: proposta.titulo,
      condicoes: proposta.condicoes,
      valid_until: proposta.valid_until,
      total_cents: resolvido.totalCents,
      pricing_status: resolvido.pricingStatus,
      moeda: proposta.moeda,
      status: "rascunho",
      numero: decisao.herdaNumero,
      ano: decisao.herdaAno,
      versao: decisao.novaVersao,
      substitui_id: decisao.substituiId,
      template_slug: proposta.template_slug,
      template_version: proposta.template_version,
      template_snapshot: proposta.template_snapshot,
      briefing_json: proposta.briefing_json,
      secoes_editadas: proposta.secoes_editadas,
      version_reason: motivo,
    })
    .select("id")
    .single();
  if (novaErr) {
    if ((novaErr as { code?: string }).code === "23505") {
      throw new ApiError(
        409,
        "validation_failed",
        undefined,
        requestId,
        t("Este negócio já tem um rascunho de proposta aberto."),
      );
    }
    throw new ApiError(500, "internal_error", undefined, requestId, t("Falha ao criar a revisão."));
  }
  if (!nova)
    throw new ApiError(500, "internal_error", undefined, requestId, t("Falha ao criar a revisão."));

  if (resolvido.itens.length > 0) {
    const { error: itensErr } = await admin.from("crm_proposal_items").insert(
      resolvido.itens.map((it) => ({
        proposal_id: nova.id,
        organization_id: ctx.organization_id,
        product_id: it.product_id,
        descricao: it.descricao,
        quantidade: it.quantidade,
        preco_unitario_cents: it.preco_unitario_cents,
        desconto_cents: it.desconto_cents,
        position: it.position,
      })),
    );
    if (itensErr) {
      // A v2 nasceu mas sem itens — descarta-a; a v1 continua `enviada` (D3,
      // mesmo raciocínio de "não substitui uma cadeia por uma v2 vazia").
      await admin
        .from("crm_proposals")
        .delete()
        .eq("organization_id", ctx.organization_id)
        .eq("id", nova.id);
      throw new ApiError(
        500,
        "internal_error",
        undefined,
        requestId,
        t("Falha ao copiar os itens da revisão."),
      );
    }
  }

  void audit({
    action: "proposal.revised",
    ...proposalAuditActor(ctx),
    organizationId: ctx.organization_id,
    resourceType: "crm_proposals",
    resourceId: nova.id,
    requestId,
    metadata: {
      proposal_id_present: true,
      revision: decisao.novaVersao,
      item_count: resolvido.itens.length,
    },
  });

  return { id: nova.id };
}
