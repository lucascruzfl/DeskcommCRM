import type { createAdminClient } from "@/lib/supabase/admin";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { proposalAuditActor } from "@/lib/propostas/administracao-audit";
// app/api/v1/settings/proposal-templates/route.ts
import { z } from "zod";

import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { MODELOS_BASE } from "@/lib/propostas/modelos/catalogo-base";
import { proximaVersao, secaoSchema, secoesParaGravar } from "@/lib/propostas/modelos/gravacao";
import { ROTULO_DO_MODELO } from "@/lib/propostas/modelos/rotulos";
import { slugDaEmpresa, validarModelo } from "@/lib/propostas/modelos/validar-modelo";

export const templatePostSchema = z.union([
  z.object({ acao: z.literal("personalizar"), base_slug: z.string().min(1).max(100) }),
  z.object({
    acao: z.literal("novo"),
    nome: z.string().max(200),
    descricao: z.string().max(300).nullable().optional(),
    sections: z.array(secaoSchema).max(40).optional(),
    section_order: z.array(z.string().max(60)).max(40).optional(),
  }),
  z.object({
    acao: z.union([z.literal("ocultar"), z.literal("mostrar")]),
    slug: z.string().min(1).max(100),
  }),
]);

const SECAO_INICIAL = {
  id: "summary",
  title: "Resumo da proposta",
  titleEs: null,
  body: "Esta proposta apresenta {{project.name}} para {{client.company_or_name}}.",
  bodyEs: null,
  required: true,
  conditional: false,
};

export async function writeProposalTemplateHandler(
  admin: ReturnType<typeof createAdminClient>,
  ctx: HandlerCtx,
  raw: unknown,
) {
  const parsed = { data: templatePostSchema.parse(raw) };
  const orgId = ctx.organization_id;
  const requestId = ctx.requestId;
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  // Desligar um modelo da plataforma: some do seletor e da lista da IA, mas
  // continua resolvendo para propostas que já o usam. Guardado em
  // `settings.proposals.modelos_ocultos`, por MERGE — nunca sobrescrever
  // `settings` nem `settings.proposals` (o mesmo cuidado do PATCH de
  // `settings/proposals`, que manda só os campos dele).
  if (parsed.data.acao === "ocultar" || parsed.data.acao === "mostrar") {
    const slug = parsed.data.slug;
    if (!Object.hasOwn(ROTULO_DO_MODELO, slug)) {
      throw new ApiError(422, "validation_failed", undefined, requestId, t("Modelo desconhecido."));
    }
    const { data: atual, error: readError } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();
    if (readError || !atual)
      throw new ApiError(
        500,
        "internal_error",
        undefined,
        ctx.requestId,
        "Falha ao consultar configuração.",
      );
    const bruto = (atual as { settings?: unknown } | null)?.settings;
    const settingsAtual =
      bruto && typeof bruto === "object" && !Array.isArray(bruto)
        ? (bruto as Record<string, unknown>)
        : {};
    const brutoPropostas = settingsAtual.proposals;
    const proposalsAtual =
      brutoPropostas && typeof brutoPropostas === "object" && !Array.isArray(brutoPropostas)
        ? (brutoPropostas as Record<string, unknown>)
        : {};
    const brutoOcultos = proposalsAtual.modelos_ocultos;
    const ocultosAtual = Array.isArray(brutoOcultos)
      ? brutoOcultos.filter((s): s is string => typeof s === "string")
      : [];
    const lista =
      parsed.data.acao === "ocultar"
        ? [...new Set([...ocultosAtual, slug])]
        : ocultosAtual.filter((s) => s !== slug);
    const settingsMesclado = {
      ...settingsAtual,
      proposals: { ...proposalsAtual, modelos_ocultos: lista },
    };

    const { error } = await admin
      .from("organizations")
      .update({ settings: settingsMesclado })
      .eq("id", orgId);
    if (error)
      throw new ApiError(500, "internal_error", undefined, requestId, t("Falha ao salvar."));

    void audit({
      action:
        parsed.data.acao === "ocultar" ? "proposal_template.hidden" : "proposal_template.shown",
      ...proposalAuditActor(ctx),
      organizationId: orgId,
      resourceType: "proposal_templates",
      resourceId: null,
      requestId,
      metadata: { template_slug_present: true },
    });
    return { slug, oculto: parsed.data.acao === "ocultar" };
  }

  let linha: Record<string, unknown>;
  if (parsed.data.acao === "personalizar") {
    const slug = parsed.data.base_slug;
    if (!Object.hasOwn(MODELOS_BASE, slug))
      throw new ApiError(
        404,
        "not_found",
        undefined,
        requestId,
        t("Modelo da plataforma não encontrado."),
      );
    const { data: ativa } = await admin
      .from("proposal_templates")
      .select("id")
      .eq("organization_id", orgId)
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (ativa)
      throw new ApiError(
        409,
        "state_conflict",
        undefined,
        requestId,
        t("Este modelo já foi personalizado."),
      );
    const base = MODELOS_BASE[slug]!;
    linha = {
      organization_id: orgId,
      slug,
      version: await proximaVersao(admin, orgId, slug),
      base_slug: slug,
      base_version: base.version,
      nome: ROTULO_DO_MODELO[slug] ?? null,
      descricao: null,
      sections: secoesParaGravar(base.sections),
      section_order: base.sectionOrder,
      is_active: true,
    };
  } else if (parsed.data.acao === "novo") {
    const nome = parsed.data.nome.trim();
    const sections = parsed.data.sections ?? [SECAO_INICIAL];
    const sectionOrder = parsed.data.section_order ?? sections.map((s) => s.id);
    const erros = validarModelo({
      nome,
      descricao: parsed.data.descricao ?? null,
      sections: sections.map((s) => ({ ...s, titleEs: null, bodyEs: null })),
      sectionOrder,
    });
    if (erros.length > 0) {
      throw new ApiError(
        422,
        "validation_failed",
        { erros },
        requestId,
        t("O modelo tem problemas."),
      );
    }
    let slug = slugDaEmpresa(nome);
    for (let n = 2; n <= 9; n++) {
      const { data: existe } = await admin
        .from("proposal_templates")
        .select("id")
        .eq("organization_id", orgId)
        .eq("slug", slug)
        .eq("is_active", true)
        .maybeSingle();
      if (!existe) break;
      slug = `${slugDaEmpresa(nome).slice(0, 57)}_${n}`;
    }
    linha = {
      organization_id: orgId,
      slug,
      version: await proximaVersao(admin, orgId, slug),
      base_slug: null,
      base_version: null,
      nome,
      descricao: parsed.data.descricao ?? null,
      sections: secoesParaGravar(sections),
      section_order: sectionOrder,
      is_active: true,
    };
  } else {
    // Inalcançável pelo schema — ocultar/mostrar já retornou acima. O else
    // existe para o TS estreitar o union no ramo "novo".
    throw new ApiError(422, "validation_failed", undefined, requestId, t("Campos inválidos."));
  }

  const { error } = await admin
    .from("proposal_templates")
    .insert({ ...linha, organization_id: orgId });
  if (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApiError(
        409,
        "state_conflict",
        undefined,
        requestId,
        t("Já existe um modelo ativo com este nome."),
      );
    throw new ApiError(500, "internal_error", undefined, requestId, t("Falha ao salvar o modelo."));
  }

  void audit({
    action: "proposal_template.saved",
    ...proposalAuditActor(ctx),
    organizationId: orgId,
    resourceType: "proposal_templates",
    resourceId: null,
    requestId,
    metadata: {
      template_slug_present: true,
      action_kind: parsed.data.acao,
      revision: linha.version,
    },
  });
  return { slug: linha.slug };
}
