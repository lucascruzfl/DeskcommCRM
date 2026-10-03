import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { proposalAuditActor } from "@/lib/propostas/administracao-audit";
// app/api/v1/proposals/[id]/documento/route.ts
import { z } from "zod";

import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { resolverAvisoDeRevisaoSeProntaOuEncerrada } from "@/lib/propostas/aviso-de-revisao";
import { definirCaminho } from "@/lib/propostas/briefing-caminho";
import {
  lerSecoesEditadas,
  montarDocumentoDaProposta,
} from "@/lib/propostas/documento/documento-da-proposta";
import type { ContatoParaDocumento } from "@/lib/propostas/documento/montar-dados";
import { ondePreencher } from "@/lib/propostas/documento/rotulos-das-variaveis";
import { extrairVariaveis } from "@/lib/propostas/documento/variaveis";
import { montarEntradaDeProntidao } from "@/lib/propostas/prontidao-da-proposta";

const SEGMENTOS_PROIBIDOS = new Set(["__proto__", "constructor", "prototype"]);

export const documentoSecaoSchema = z.object({
  secaoId: z.string().trim().min(1).max(100),
  // null = voltar ao texto do modelo. Texto vazio não é aceito: esvaziar uma
  // seção obrigatória sem dizer nada é pior que o [a definir] que ela tinha.
  texto: z.string().trim().min(1).max(20000).nullable(),
});
export const documentoCampoSchema = z.object({
  campo: z
    .string()
    .max(200)
    .regex(/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/)
    .refine((c) => !c.split(".").some((s) => SEGMENTOS_PROIBIDOS.has(s))),
  valor: z.string().trim().min(1).max(4000),
});
export const documentoPatchSchema = z.union([documentoSecaoSchema, documentoCampoSchema]);

type Admin = SupabaseClient;

interface LinhaDaProposta {
  id: string;
  organization_id: string;
  status: string;
  template_slug: string | null;
  template_slug_sugerido: string | null;
  briefing_json: unknown;
  secoes_editadas: unknown;
  pricing_status: "missing" | "catalog" | "manual" | "custom" | "approved";
  contact_id: string | null;
  titulo: string | null;
  prazo_dias_uteis: number | null;
  pagamento: string | null;
  valid_until: string | null;
  total_cents: number;
  moeda: string;
  created_at: string;
}

async function buscarProposta(
  admin: Admin,
  orgId: string,
  id: string,
): Promise<LinhaDaProposta | null> {
  const { data } = await admin
    .from("crm_proposals")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return (data as LinhaDaProposta | null) ?? null;
}

async function buscarContato(
  admin: Admin,
  orgId: string,
  contactId: string | null,
): Promise<ContatoParaDocumento | null> {
  if (!contactId) return null;
  const { data } = await admin
    .from("contacts")
    .select("name, display_name")
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();
  return (data as ContatoParaDocumento | null) ?? null;
}

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

export async function getProposalDocumentHandler(
  admin: SupabaseClient,
  ctx: HandlerCtx,
  id: string,
) {
  const requestId = ctx.requestId;
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  const proposta = await buscarProposta(admin, ctx.organization_id, id);
  if (!proposta)
    throw new ApiError(404, "not_found", undefined, requestId, t("Proposta não encontrada."));

  const base = {
    status: proposta.status,
    modeloSlug: proposta.template_slug,
    modeloSlugSugerido: proposta.template_slug_sugerido,
    secoes: [] as unknown[],
    variaveisFaltando: [] as string[],
    camposFaltando: [] as unknown[],
    temSecaoEditada: Object.keys(lerSecoesEditadas(proposta.secoes_editadas)).length > 0,
    prontidao: null as unknown,
    resumoComercial: null,
  };
  if (!proposta.template_slug) return base;

  const contato = await buscarContato(admin, ctx.organization_id, proposta.contact_id);
  const documento = await montarDocumentoDaProposta(admin, ctx.organization_id, proposta, contato);
  if (!documento) return base;

  const { data: itens } = await admin
    .from("crm_proposal_items")
    .select("preco_unitario_cents")
    .eq("organization_id", ctx.organization_id)
    .eq("proposal_id", id);
  const temItensComPreco =
    (itens ?? []).length > 0 && (itens ?? []).every((it) => it.preco_unitario_cents !== null);

  const prontidao = montarEntradaDeProntidao(
    {
      contact_id: proposta.contact_id,
      titulo: proposta.titulo,
      pricing_status: proposta.pricing_status,
      prazo_dias_uteis: proposta.prazo_dias_uteis,
      pagamento: proposta.pagamento,
      valid_until: proposta.valid_until,
      briefing_json: proposta.briefing_json,
    },
    temItensComPreco,
  );

  return {
    ...base,
    modeloSlug: documento.modelo.slug,
    secoes: documento.secoes,
    variaveisFaltando: documento.pendencias,
    camposFaltando: documento.camposFaltando,
    prontidao,
  };
}
export async function updateProposalDocumentHandler(
  admin: SupabaseClient,
  ctx: HandlerCtx,
  id: string,
  raw: unknown,
) {
  const requestId = ctx.requestId;
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  const parsed = { data: documentoPatchSchema.parse(raw) };
  const proposta = await buscarProposta(admin, ctx.organization_id, id);
  if (!proposta)
    throw new ApiError(404, "not_found", undefined, requestId, t("Proposta não encontrada."));
  // Achado do plano M6 que ficou sem dono: editar uma proposta já enviada
  // mudava a tela sem mudar o que o cliente recebeu.
  if (proposta.status !== "rascunho") {
    throw new ApiError(
      409,
      "proposal_context_stale",
      undefined,
      requestId,
      t("Só é possível editar o documento de uma proposta em rascunho."),
    );
  }

  if ("campo" in parsed.data) {
    const { campo, valor } = parsed.data;
    const contato = await buscarContato(admin, ctx.organization_id, proposta.contact_id);
    const documento = await montarDocumentoDaProposta(
      admin,
      ctx.organization_id,
      proposta,
      contato,
    );
    if (!documento) {
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        requestId,
        t("Escolha o modelo da proposta antes de preencher campos."),
      );
    }
    const variaveisDoModelo = new Set(
      documento.modelo.sections.flatMap((s) => extrairVariaveis(s.body)),
    );
    if (!variaveisDoModelo.has(campo) || ondePreencher(campo) !== "briefing") {
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        requestId,
        t("Este campo não se preenche por aqui."),
      );
    }

    const briefing = definirCaminho(comoObjeto(proposta.briefing_json), campo, valor);
    const { data: updated, error } = await admin
      .from("crm_proposals")
      .update({ briefing_json: briefing })
      .eq("organization_id", ctx.organization_id)
      .eq("id", id)
      .eq("status", "rascunho")
      .select("id")
      .maybeSingle();
    if (error)
      throw new ApiError(
        500,
        "internal_error",
        undefined,
        requestId,
        t("Falha ao salvar o campo."),
      );
    if (!updated)
      throw new ApiError(
        409,
        "proposal_context_stale",
        undefined,
        requestId,
        t("Só é possível editar o documento de uma proposta em rascunho."),
      );

    void resolverAvisoDeRevisaoSeProntaOuEncerrada(admin, ctx.organization_id, id);
    void audit({
      action: "proposal.documento_campo_preenchido",
      ...proposalAuditActor(ctx),
      organizationId: ctx.organization_id,
      resourceType: "crm_proposals",
      resourceId: id,
      requestId,
      metadata: { fields_changed: ["briefing_json"] },
    });
    return { campo };
  }

  const { secaoId, texto } = parsed.data;
  const editadas = lerSecoesEditadas(proposta.secoes_editadas);
  if (texto === null) delete editadas[secaoId];
  else editadas[secaoId] = texto;
  const secoesEditadas = Object.keys(editadas).length > 0 ? editadas : null;

  const { data: updated, error } = await admin
    .from("crm_proposals")
    .update({ secoes_editadas: secoesEditadas })
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .eq("status", "rascunho")
    .select("id")
    .maybeSingle();
  if (error)
    throw new ApiError(500, "internal_error", undefined, requestId, t("Falha ao salvar a seção."));
  if (!updated)
    throw new ApiError(
      409,
      "proposal_context_stale",
      undefined,
      requestId,
      t("Só é possível editar o documento de uma proposta em rascunho."),
    );

  void resolverAvisoDeRevisaoSeProntaOuEncerrada(admin, ctx.organization_id, id);
  void audit({
    action: "proposal.documento_editado",
    ...proposalAuditActor(ctx),
    organizationId: ctx.organization_id,
    resourceType: "crm_proposals",
    resourceId: id,
    requestId,
    metadata: { fields_changed: ["secoes_editadas"], restored: texto === null },
  });

  return { secoesEditadas };
}
