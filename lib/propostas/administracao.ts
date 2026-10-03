/** Operações administrativas canônicas, compartilhadas por HTTP e MCP. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { proposalAuditActor } from "./administracao-audit";
import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { resolverItensDaProposta } from "./itens";
import { propostaItemSchema } from "@/lib/schemas/propostas";
import { resolverAvisoDeRevisaoSeProntaOuEncerrada } from "./aviso-de-revisao";
export const proposalPatchSchema = z.object({
  revision: z.number().int().positive(),
  titulo: z.string().trim().min(1).max(200).optional(),
  condicoes: z.string().max(4000).nullable().optional(),
  valid_until: z.string().date().nullable().optional(),
  prazo_dias_uteis: z.number().int().min(1).max(365).nullable().optional(),
  pagamento: z.string().trim().max(500).nullable().optional(),
  itens: z.array(propostaItemSchema),
});

export async function listProposalsHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  input: { status?: string | null; lead_id?: string | null },
) {
  let q = supabase
    .from("crm_proposals")
    .select(
      "id, lead_id, titulo, status, total_cents, moeda, numero, ano, versao, valid_until, created_at, drafted_by_agent_id",
    )
    .eq("organization_id", ctx.organization_id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (input.status) q = q.eq("status", input.status);
  if (input.lead_id) q = q.eq("lead_id", input.lead_id);
  const { data, error } = await q;
  if (error)
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      "Falha ao listar propostas.",
    );
  return data ?? [];
}

export async function getProposalHandler(supabase: SupabaseClient, ctx: HandlerCtx, id: string) {
  z.string().uuid().parse(id);
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  const { data: proposta, error: propostaError } = await supabase
    .from("crm_proposals")
    .select("*")
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .maybeSingle();

  if (propostaError)
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      t("Falha ao carregar a proposta."),
    );
  if (!proposta)
    throw new ApiError(404, "not_found", undefined, ctx.requestId, t("Proposta não encontrada."));

  const { data: itens, error: itensError } = await supabase
    .from("crm_proposal_items")
    .select("*")
    .eq("organization_id", ctx.organization_id)
    .eq("proposal_id", id)
    .order("position", { ascending: true });

  if (itensError)
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      t("Falha ao carregar os itens."),
    );

  // N4 — preço ATUAL do catálogo junto do item, para o editor detectar drift.
  // Uma consulta em lote (não N): item manual (product_id nulo) nunca participa;
  // produto apagado desde então contribui com null, sem quebrar.
  const idsDeProduto = [
    ...new Set(
      (itens ?? []).map((it) => it.product_id).filter((pid): pid is string => pid !== null),
    ),
  ];
  const precoAtualPorProduto = new Map<string, number>();
  if (idsDeProduto.length > 0) {
    const { data: produtos } = await supabase
      .from("catalog_products")
      .select("id, preco_cents")
      .eq("organization_id", ctx.organization_id)
      .in("id", idsDeProduto);
    for (const p of (produtos ?? []) as Array<{ id: string; preco_cents: number }>) {
      precoAtualPorProduto.set(p.id, p.preco_cents);
    }
  }
  const itensComDrift = (itens ?? []).map((it) => ({
    ...it,
    preco_catalogo_atual_cents: it.product_id
      ? (precoAtualPorProduto.get(it.product_id) ?? null)
      : null,
  }));

  return { ...proposta, itens: itensComDrift };
}

export async function updateDraftProposalHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  id: string,
  raw: unknown,
) {
  z.string().uuid().parse(id);
  const input = proposalPatchSchema.parse(raw);
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  // D11 — a edição não muda a moeda da proposta (fora de escopo); os itens
  // são resolvidos contra a moeda JÁ GRAVADA. A leitura que falta devolve o
  // MESMO 409 ambíguo do UPDATE abaixo (convenção desta rota: nunca vazar a
  // existência para outra organização — ver teste "não altera proposta de
  // outra organização"), não o 404 do plano, de propósito.
  const { data: propostaAtual } = await supabase
    .from("crm_proposals")
    .select("moeda")
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (!propostaAtual) {
    throw new ApiError(
      409,
      "proposal_context_stale",
      undefined,
      ctx.requestId,
      t("A proposta mudou (ou não está mais em rascunho). Recarregue antes de editar."),
    );
  }
  const resolvido = await resolverItensDaProposta(
    supabase,
    ctx.organization_id,
    input.itens,
    (propostaAtual as { moeda: string }).moeda,
  );
  if (!resolvido.ok) {
    throw new ApiError(422, "validation_failed", undefined, ctx.requestId, t(resolvido.motivo));
  }
  const { data: proposta, error } = await supabase
    .from("crm_proposals")
    .update({
      ...(input.titulo !== undefined ? { titulo: input.titulo } : {}),
      ...(input.condicoes !== undefined ? { condicoes: input.condicoes } : {}),
      ...(input.valid_until !== undefined ? { valid_until: input.valid_until } : {}),
      ...(input.prazo_dias_uteis !== undefined ? { prazo_dias_uteis: input.prazo_dias_uteis } : {}),
      ...(input.pagamento !== undefined
        ? { pagamento: input.pagamento === "" ? null : input.pagamento }
        : {}),
      total_cents: resolvido.totalCents,
      pricing_status: resolvido.pricingStatus,
      revision: input.revision + 1,
    })
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .eq("revision", input.revision)
    .eq("status", "rascunho")
    .select("id, revision")
    .maybeSingle();

  if (error)
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      t("Falha ao editar a proposta."),
    );
  if (!proposta) {
    throw new ApiError(
      409,
      "proposal_context_stale",
      undefined,
      ctx.requestId,
      t("A proposta mudou (ou não está mais em rascunho). Recarregue antes de editar."),
    );
  }

  const { error: deleteError } = await supabase
    .from("crm_proposal_items")
    .delete()
    .eq("organization_id", ctx.organization_id)
    .eq("proposal_id", id);
  if (deleteError)
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      t("Falha ao remover os itens anteriores."),
    );

  if (input.itens.length > 0) {
    const { error: insertError } = await supabase.from("crm_proposal_items").insert(
      resolvido.itens.map((it) => ({
        organization_id: ctx.organization_id,
        proposal_id: id,
        product_id: it.product_id,
        descricao: it.descricao,
        quantidade: it.quantidade,
        preco_unitario_cents: it.preco_unitario_cents,
        desconto_cents: it.desconto_cents,
        position: it.position,
      })),
    );
    if (insertError)
      throw new ApiError(
        500,
        "internal_error",
        undefined,
        ctx.requestId,
        t("Falha ao gravar os itens."),
      );
  }

  void resolverAvisoDeRevisaoSeProntaOuEncerrada(supabase, ctx.organization_id, id);

  void audit({
    action: "proposal.edited",
    actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
    actorApiTokenId:
      ctx.actor.type === "api_token"
        ? ctx.actor.id
        : ctx.actor.type === "ai_agent"
          ? (ctx.actor.api_token_id ?? null)
          : null,
    metadata: {
      revision: input.revision,
      item_count: input.itens.length,
      campos_alterados: Object.keys(input).sort(),
    },
    organizationId: ctx.organization_id,
    resourceType: "crm_proposals",
    resourceId: id,
    requestId: ctx.requestId,
  });

  return { id, revision: proposta.revision, total_cents: resolvido.totalCents };
}

export async function discardDraftProposalHandler(supabase: SupabaseClient, ctx: HandlerCtx, id: string) {
  z.string().uuid().parse(id);
  const requestId = ctx.requestId;
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  const { data: proposta, error } = await supabase
    .from("crm_proposals")
    .update({ status: "cancelada" })
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .eq("status", "rascunho")
    .select("id")
    .maybeSingle();

  if (error) throw new ApiError(500, "internal_error", undefined, requestId, t("Falha ao descartar a proposta."));
  if (!proposta) {
    throw new ApiError(409, "proposal_context_stale", undefined, requestId, t("Só é possível descartar uma proposta em rascunho."));
  }

  void resolverAvisoDeRevisaoSeProntaOuEncerrada(supabase, ctx.organization_id, id, { forcar: true });

  void audit({
    action: "proposal.discarded",
    ...proposalAuditActor(ctx),
    organizationId: ctx.organization_id,
    resourceType: "crm_proposals",
    resourceId: id,
    requestId,
  });

  return { id, status: "cancelada" };
}
