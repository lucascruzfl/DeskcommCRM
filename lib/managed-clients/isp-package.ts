import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { criarPipeline, atualizarConfiguracaoDoPipeline, atualizarPipeline } from "@/lib/pipelines/operations";
import { pipelineConfigPatchSchema } from "@/lib/schemas/settings";
import { chaveDaEtiqueta } from "@/lib/tags/cor-da-etiqueta";
import { tagSchema } from "@/lib/schemas/tags";
import type { PropostaDeFunil } from "@/lib/onboarding/proposta-de-funil";

export const ispPackageInputSchema = z.object({ organization_id: z.uuid() }).strict();

export const ISP_PIPELINE = "Vendas — Internet";
export const ISP_STAGES: PropostaDeFunil["etapas"] = [
  { nome: "Novo lead", passo: "new" },
  { nome: "Verificar cobertura", passo: "qualifying" },
  { nome: "Plano apresentado", passo: "qualified" },
  { nome: "Aguardando documentos", passo: "negotiating" },
  { nome: "Instalação", passo: null },
  { nome: "Cliente ativado", passo: "won" },
  { nome: "Não contratado", passo: "lost" },
];
export const ISP_TAGS = ["lead", "sem-cobertura", "aguardando-documentos", "instalacao", "cliente-ativo", "suporte", "financeiro", "cancelamento"] as const;
export const ISP_LOST_REASONS = [
  { label: "Sem cobertura", categoria: "Nós" },
  { label: "Desistiu", categoria: "Cliente" },
  { label: "Sem retorno", categoria: "Ausência" },
] as const;
export const ISP_FIELDS = [
  { key: "cep", label: "CEP", type: "text", required: false },
  { key: "endereco", label: "Endereço", type: "text", required: false },
  { key: "numero", label: "Número", type: "text", required: false },
  { key: "complemento", label: "Complemento", type: "text", required: false },
  { key: "bairro", label: "Bairro", type: "text", required: false },
  { key: "cidade", label: "Cidade", type: "text", required: false },
  { key: "plano_interesse", label: "Plano de interesse", type: "text", required: false },
  { key: "codigo_cliente_contrato", label: "Código do cliente/contrato", type: "text", required: false },
] as const;
export const ISP_ROUTING = [
  { intencao: "contratar internet", destino: "Comercial", estado: "pendente_7c" },
  { intencao: "internet caiu", destino: "Suporte/humano", estado: "pendente_7c" },
  { intencao: "segunda via", destino: "Financeiro", estado: "pendente_7c" },
  { intencao: "quando instalar", destino: "Instalação", estado: "pendente_7c" },
] as const;
export const ISP_FOLLOWUPS = [
  { gatilho: "dias_na_mesma_etapa", etapa: "Aguardando documentos", acao: "tarefa_interna", dias: null },
  { gatilho: "dias_na_mesma_etapa", etapa: "Instalação", acao: "tarefa_interna", dias: null },
  { gatilho: "dias_sem_mensagem", etapa: "Plano apresentado", acao: "tarefa_interna", dias: null },
] as const;
/** Snapshot do seed `fn_seed_default_pipeline_for_org`; divergência preserva o padrão do cliente. */
export const SEED_PIPELINE_SETTINGS = {
  fields: [], canonical_tags: [], lost_reasons: [],
  identity_resolution: { fields_in_priority_order: ["cpf", "phone_e164", "email"] },
} as const;
export const SEED_PIPELINE_VOCABULARY = {
  lead: "Cliente", lead_plural: "Clientes", deal: "Pedido", deal_plural: "Pedidos",
  won: "Pago", lost: "Cancelado", stage: "Etapa", stage_plural: "Etapas",
} as const;

const CONFIG = pipelineConfigPatchSchema.parse({
  fields: ISP_FIELDS,
  lost_reasons: ISP_LOST_REASONS,
  reabertura: "novo_negocio",
  reabertura_campos: ["custom_fields", "tags"],
});
const PENDENCIAS = [
  "Comercial: contratar internet — definir agente e canal na 7C",
  "Suporte/humano: internet caiu — definir equipe e canal na 7C",
  "Financeiro: segunda via — definir equipe e canal na 7C",
  "Instalação: quando instalar — definir equipe e canal na 7C",
  "Follow-ups: definir dias sem mensagem e dias na etapa; criar só tarefas internas após aprovação da política",
] as const;

export interface IspPackageActor {
  userId: string | null;
  apiTokenId?: string | null;
  requestId: string;
}
interface Deps { admin: () => SupabaseClient; audit: typeof audit }
const defaults: Deps = { admin: createAdminClient, audit };
type Row = Record<string, unknown>;

function tagName(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Row).tag === "string") return (value as Row).tag as string;
  return null;
}
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, comparable(nested)]));
  }
  return value;
}
function equivalent(a: unknown, b: unknown): boolean {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}
function unavailable(): never { throw new Error("managed_isp_package_unavailable"); }

/** A aplicação é retomável: cada escrita tem leitura, conflito e chave estável. */
export function createIspPackageService(deps: Deps = defaults) {
  async function plan(organizationId: string, actor: IspPackageActor) {
    ispPackageInputSchema.parse({ organization_id: organizationId });
    const db = deps.admin();
    const conflicts: string[] = [];
    const existing: string[] = [];
    const toCreate: string[] = [];
    const warnings: string[] = [];
    if (!actor.userId || !z.uuid().safeParse(actor.userId).success) conflicts.push("authenticated_actor_required");
    else {
      const { data: platform, error: platformError } = await db.from("platform_admins")
        .select("scope,mfa_required").eq("user_id", actor.userId).is("revoked_at", null).maybeSingle();
      if (platformError) unavailable();
      if (platform?.scope !== "full" || platform.mfa_required) conflicts.push("platform_admin_full_required");
      const { data: member, error: memberError } = await db.from("user_organizations")
        .select("role").eq("organization_id", organizationId).eq("user_id", actor.userId)
        .is("revoked_at", null).not("accepted_at", "is", null).maybeSingle();
      if (memberError) unavailable();
      if (member?.role !== "admin") conflicts.push("agency_membership_required");
    }
    // Não revelar se a organização existe a um ator sem autoridade atual.
    if (conflicts.length) return { organization_id: organizationId, a_criar: toCreate, criado: [], ja_existia: existing,
      conflitos: conflicts, pendencias: [...PENDENCIAS], roteamento: ISP_ROUTING, followups: ISP_FOLLOWUPS,
      warnings, can_execute: false, requires_confirmation: true };

    const { data: policy, error: policyError } = await db.from("managed_client_policies")
      .select("business_type,management_mode,preset_id").eq("organization_id", organizationId).maybeSingle();
    if (policyError) unavailable();
    if (policy?.management_mode !== "managed" || policy.preset_id !== "managed/internet-provider" || policy.business_type !== "internet_provider")
      conflicts.push("managed_internet_provider_required");
    if (conflicts.length) return { organization_id: organizationId, a_criar: toCreate, criado: [], ja_existia: existing,
      conflitos: conflicts, pendencias: [...PENDENCIAS], roteamento: ISP_ROUTING, followups: ISP_FOLLOWUPS,
      warnings, can_execute: false, requires_confirmation: true };

    const { data: allPipelines, error: pipelineError } = await db.from("crm_pipelines")
      .select("id,name,slug,description,is_archived,is_default,settings,vocabulary")
      .eq("organization_id", organizationId);
    if (pipelineError) unavailable();
    const pipelines = (allPipelines ?? []).filter((row) => row.slug === "vendas-internet" || row.name === ISP_PIPELINE);
    const pipeline = pipelines?.[0] as Row | undefined;
    if ((pipelines?.length ?? 0) > 1) conflicts.push("pipeline_identifier_conflict");
    if (pipeline) {
      if (pipeline.name !== ISP_PIPELINE || pipeline.slug !== "vendas-internet" || pipeline.is_archived) conflicts.push("pipeline_identifier_conflict");
      else {
        existing.push("pipeline");
        const { data: stages, error: stageError } = await db.from("crm_stages")
          .select("name,is_won,is_lost,agent_stage_hint,is_archived")
          .eq("organization_id", organizationId).eq("pipeline_id", String(pipeline.id))
          .order("position", { ascending: true });
        if (stageError) unavailable();
        const expected = ISP_STAGES.map((s) => ({ name: s.nome, is_won: s.passo === "won", is_lost: s.passo === "lost", agent_stage_hint: s.passo, is_archived: false }));
        if (!equivalent(stages, expected)) conflicts.push("pipeline_stages_conflict");
        else existing.push("stages");
        const settings = (pipeline.settings ?? {}) as Row;
        for (const [key, target] of Object.entries(CONFIG)) {
          const current = settings[key];
          if (current === undefined || (Array.isArray(current) && current.length === 0)) toCreate.push(`pipeline.${key}`);
          else if (equivalent(current, target)) existing.push(`pipeline.${key}`);
          else conflicts.push(`pipeline.${key}_conflict`);
        }
      }
    } else { toCreate.push("pipeline", "stages", "pipeline.fields", "pipeline.lost_reasons", "pipeline.reabertura", "pipeline.reabertura_campos"); }

    const currentDefault = (allPipelines ?? []).find((row) => row.is_default);
    if (pipeline?.is_default) existing.push("pipeline.default");
    else if (!currentDefault) toCreate.push("pipeline.default");
    else if (currentDefault.name === "Pedidos" && currentDefault.slug === "pedidos" && !currentDefault.is_archived) {
      const { data: seedStages, error: seedError } = await db.from("crm_stages")
        .select("name,is_won,is_lost,is_archived").eq("organization_id", organizationId)
        .eq("pipeline_id", String(currentDefault.id)).order("position", { ascending: true });
      if (seedError) unavailable();
      const untouched = (currentDefault.description == null)
        && equivalent(currentDefault.settings, SEED_PIPELINE_SETTINGS)
        && equivalent(currentDefault.vocabulary, SEED_PIPELINE_VOCABULARY)
        && equivalent(seedStages, [
        "Carrinho abandonado", "Aguardando pagamento", "Pago", "Em separação",
        "Enviado", "Entregue", "Pós-venda", "Cancelado",
      ].map((name) => ({ name, is_won: name === "Pago", is_lost: name === "Cancelado", is_archived: false })));
      if (untouched) {
        const { count, error: leadError } = await db.from("crm_leads")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId).eq("pipeline_id", String(currentDefault.id));
        if (leadError) unavailable();
        if (count === 0) toCreate.push("pipeline.default");
        else warnings.push("default_pipeline_in_use");
      } else warnings.push("default_pipeline_customized");
    } else warnings.push("default_pipeline_customized");

    const { data: org, error: orgError } = await db.from("organizations")
      .select("settings").eq("id", organizationId).maybeSingle();
    if (orgError || !org) unavailable();
    const rawTags = (org.settings as Row | null)?.tags;
    if (rawTags !== undefined && !Array.isArray(rawTags)) conflicts.push("tag_vocabulary_conflict");
    const counts = new Map<string, number>();
    for (const name of (Array.isArray(rawTags) ? rawTags : []).map(tagName).filter((name): name is string => !!name)) {
      const key = chaveDaEtiqueta(name);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const tag of ISP_TAGS) {
      tagSchema.parse(tag);
      if ((counts.get(tag) ?? 0) > 1) conflicts.push(`tag:${tag}_duplicate_conflict`);
      else if (counts.has(tag)) existing.push(`tag:${tag}`);
      else toCreate.push(`tag:${tag}`);
    }
    return { organization_id: organizationId, a_criar: toCreate, criado: [], ja_existia: existing,
      conflitos: conflicts, pendencias: [...PENDENCIAS], roteamento: ISP_ROUTING, followups: ISP_FOLLOWUPS,
      warnings, can_execute: conflicts.length === 0,
      requires_confirmation: true, pipeline_id: pipeline?.id ?? null,
      previous_default_id: currentDefault?.id ?? null };
  }

  async function execute(organizationId: string, actor: IspPackageActor, confirm: boolean) {
    const before = await plan(organizationId, actor);
    if (!confirm) return before;
    if (!before.can_execute) throw new Error("managed_isp_package_denied");
    const db = deps.admin();
    const context = { supabase: db, organizationId,
      actor: actor.apiTokenId
        ? { type: "api_token" as const, id: actor.apiTokenId }
        : { type: "user" as const, id: actor.userId! },
      requestId: actor.requestId, apiTokenId: actor.apiTokenId ?? undefined };
    let pipelineId = before.pipeline_id as string | null;
    const created: string[] = [];
    if (!pipelineId) {
      const result = await criarPipeline(context, { name: ISP_PIPELINE, etapas: ISP_STAGES });
      pipelineId = String(result.id);
      created.push("pipeline", "stages");
    }
    const patch: Row = {};
    for (const [key, value] of Object.entries(CONFIG)) if (before.a_criar.includes(`pipeline.${key}`)) patch[key] = value;
    if (Object.keys(patch).length) {
      await atualizarConfiguracaoDoPipeline(context, pipelineId, pipelineConfigPatchSchema.parse(patch));
      created.push(...Object.keys(patch).map((key) => `pipeline.${key}`));
    }
    if (before.a_criar.includes("pipeline.default")) {
      // O primeiro funil criado já nasce padrão pela operação canônica.
      if (!created.includes("pipeline") || before.previous_default_id)
        await atualizarPipeline(context, pipelineId, { is_default: true });
      created.push("pipeline.default");
    }
    const tagsToAdd = ISP_TAGS.filter((tag) => before.a_criar.includes(`tag:${tag}`));
    if (tagsToAdd.length) {
      const { data: org, error: readError } = await db.from("organizations")
        .select("settings").eq("id", organizationId).maybeSingle();
      if (readError || !org) unavailable();
      const settings = (org.settings ?? {}) as Row;
      if (settings.tags !== undefined && !Array.isArray(settings.tags)) unavailable();
      const current = Array.isArray(settings.tags) ? settings.tags : [];
      const present = new Set(current.map(tagName).filter((name): name is string => !!name).map(chaveDaEtiqueta));
      const additions = tagsToAdd.filter((tag) => !present.has(tag));
      if (additions.length) {
        const { data: updated, error: writeError } = await db.from("organizations")
          .update({ settings: { ...settings, tags: [...current, ...additions] } })
          .eq("id", organizationId).filter("settings", "eq", JSON.stringify(settings))
          .select("id").maybeSingle();
        if (writeError || !updated) unavailable();
        created.push(...additions.map((tag) => `tag:${tag}`));
      }
    }
    if (created.length) await deps.audit({ action: "managed_client.operational_package_applied",
      organizationId, actorUserId: actor.userId, actorApiTokenId: actor.apiTokenId ?? null,
      actingAsPlatformAdmin: true, bypassedRls: true, resourceType: "crm_pipeline",
      resourceId: pipelineId, requestId: actor.requestId, metadata: { package: "managed/internet-provider", created } });
    return { organization_id: organizationId, pipeline_id: pipelineId, criado: created,
      ja_existia: before.ja_existia, conflitos: [], pendencias: [...PENDENCIAS], warnings: before.warnings,
      roteamento: ISP_ROUTING, followups: ISP_FOLLOWUPS,
      status: created.length ? "applied" : "already_applied" };
  }
  return { preflight: plan, execute };
}

export const ispPackageService = createIspPackageService();
