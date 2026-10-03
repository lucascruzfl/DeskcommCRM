import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { proposalAuditActor } from "@/lib/propostas/administracao-audit";
// app/api/v1/settings/proposal-templates/[slug]/route.ts
import { z } from "zod";

import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { MODELOS_BASE } from "@/lib/propostas/modelos/catalogo-base";
import { ROTULO_DO_MODELO } from "@/lib/propostas/modelos/rotulos";
import { validarModelo } from "@/lib/propostas/modelos/validar-modelo";
import { proximaVersao, secaoSchema, secoesParaGravar } from "@/lib/propostas/modelos/gravacao";

export const templatePatchSchema = z.object({
  nome: z.string().max(200),
  descricao: z.string().max(300).nullable(),
  sections: z.array(secaoSchema).max(40),
  section_order: z.array(z.string().max(60)).max(40),
});

interface LinhaDoModelo {
  id: string;
  slug: string;
  nome: string | null;
  descricao: string | null;
  version: number;
  sections: Array<{
    id: string;
    title: string;
    body: string;
    required: boolean;
    conditional: boolean;
  }>;
  section_order: string[];
}

async function copiaAtiva(admin: SupabaseClient, orgId: string, slug: string) {
  const { data } = await admin
    .from("proposal_templates")
    .select("id, slug, nome, descricao, version, sections, section_order")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  return (data as LinhaDoModelo | null) ?? null;
}

export async function getProposalTemplateHandler(
  admin: SupabaseClient,
  ctx: HandlerCtx,
  slug: string,
) {
  const requestId = ctx.requestId;
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  const copia = await copiaAtiva(admin, ctx.organization_id, slug);
  if (copia) {
    return {
      slug,
      nome: copia.nome ?? ROTULO_DO_MODELO[slug] ?? slug,
      descricao: copia.descricao,
      origem: Object.hasOwn(MODELOS_BASE, slug) ? "personalizado" : "empresa",
      version: copia.version,
      sections: copia.sections,
      sectionOrder: copia.section_order,
    };
  }
  if (Object.hasOwn(MODELOS_BASE, slug)) {
    const base = MODELOS_BASE[slug]!;
    return {
      slug,
      nome: ROTULO_DO_MODELO[slug] ?? slug,
      descricao: null,
      origem: "plataforma",
      version: base.version,
      sections: base.sections,
      sectionOrder: base.sectionOrder,
    };
  }
  throw new ApiError(404, "not_found", undefined, requestId, t("Modelo não encontrado."));
}
export async function updateProposalTemplateHandler(
  admin: SupabaseClient,
  ctx: HandlerCtx,
  slug: string,
  raw: unknown,
) {
  const requestId = ctx.requestId;
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  const parsed = { data: templatePatchSchema.parse(raw) };
  const erros = validarModelo({
    nome: parsed.data.nome,
    descricao: parsed.data.descricao,
    sections: parsed.data.sections.map((s) => ({ ...s, titleEs: null, bodyEs: null })),
    sectionOrder: parsed.data.section_order,
  });
  if (erros.length > 0)
    throw new ApiError(
      422,
      "validation_failed",
      { erros },
      requestId,
      t("O modelo tem problemas."),
    );

  const copia = await copiaAtiva(admin, ctx.organization_id, slug);
  if (!copia) {
    throw new ApiError(
      409,
      "state_conflict",
      undefined,
      requestId,
      t("Personalize o modelo da plataforma antes de editá-lo."),
    );
  }
  const version = await proximaVersao(admin, ctx.organization_id, slug);
  const { error } = await admin
    .from("proposal_templates")
    .update({
      nome: parsed.data.nome.trim(),
      descricao: parsed.data.descricao,
      sections: secoesParaGravar(parsed.data.sections),
      section_order: parsed.data.section_order,
      version,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", ctx.organization_id)
    .eq("id", copia.id);
  if (error)
    throw new ApiError(500, "internal_error", undefined, requestId, t("Falha ao salvar o modelo."));

  void audit({
    action: "proposal_template.saved",
    ...proposalAuditActor(ctx),
    organizationId: ctx.organization_id,
    resourceType: "proposal_templates",
    resourceId: copia.id,
    requestId,
    metadata: { template_slug_present: true, revision: version },
  });
  return { slug, version };
}
export async function deactivateProposalTemplateHandler(
  admin: SupabaseClient,
  ctx: HandlerCtx,
  slug: string,
) {
  const requestId = ctx.requestId;
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  const copia = await copiaAtiva(admin, ctx.organization_id, slug);
  if (!copia)
    throw new ApiError(
      404,
      "not_found",
      undefined,
      requestId,
      t("Não há cópia da empresa para este modelo."),
    );
  const { error } = await admin
    .from("proposal_templates")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organization_id)
    .eq("id", copia.id);
  if (error)
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      requestId,
      t("Falha ao desativar o modelo."),
    );

  void audit({
    action: "proposal_template.deactivated",
    ...proposalAuditActor(ctx),
    organizationId: ctx.organization_id,
    resourceType: "proposal_templates",
    resourceId: copia.id,
    requestId,
    metadata: { template_slug_present: true },
  });
  return { slug };
}
