/**
 * GET /api/v1/contacts/[id]/crm-summary — o resumo de CRM do painel do inbox.
 *
 * POR QUE ESTA ROTA EXISTE (não é organização, é correção de defeito):
 * o `CRMSidePanel` consultava `crm_leads`, `orders` e `crm_lead_activities`
 * DIRETO do navegador, pelo cliente de browser. O cookie de sessão é httpOnly
 * (CLAUDE.md), então o supabase-js do browser não enxerga a sessão e as
 * consultas saem como **anônimas** — provado lendo o `role` do token: `anon`,
 * com um gerente logado na tela.
 *
 * O efeito era pior que um erro:
 *   crm_leads           → a policy chama fn_can_view_lead, que `anon` não pode
 *                         executar → 401 / 42501
 *   crm_lead_activities → a policy usa fn_user_org_ids, que é PUBLIC → `anon`
 *                         chama, avalia falso → **200 com lista vazia**
 *   orders              → idem
 * Um erro e dois silêncios, e a tela traduzia os três para "Sem leads." — uma
 * afirmação sobre o NEGÓCIO feita em cima de uma falha de permissão.
 *
 * A correção **não** é dar EXECUTE a `anon`: `fn_can_view_lead` é primitiva de
 * autorização, e a policy a usa para decidir quem enxerga o quê. É trazer a
 * leitura para o servidor, onde a sessão existe — mesma decisão que o repo já
 * tomou para o fetch do board e para o token de realtime.
 *
 * **Um pedido, um veredito.** As três consultas falham juntas de propósito: a
 * alternativa (status por seção) triplicaria os estados no componente, e a
 * doença que esta rota cura é exatamente estados distintos colapsados num só.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { prospectEnrichmentSchema } from "@/lib/prospecting/schema";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";
import { managedAreaAllowedForActor } from "@/lib/managed-clients/server";

export const dynamic = "force-dynamic";

/**
 * O funil operacional fornece os campos customizados sem publicar a linha base.
 * Nome do funil e da etapa entram porque dois leads de mesmo título em funis
 * diferentes ficavam idênticos na lista (#943). Os IDs de funis ativos são
 * filtrados antes do `limit(3)` — `pipeline_id` é NOT NULL.
 */
const LEAD_COLS =
  "id, title, status, value_cents, currency, updated_at, pipeline_id, stage_id, custom_fields";
const ORDER_COLS = "id, external_id, status, total_cents, currency, created_at";
/** Acompanha o que a timeline mostra — `reason` e `actor_kind` inclusive. */
/**
 * `performed_by_user_id` entra porque a timeline dizia "Você/time" para TODA
 * ação humana — o painel sabia que uma pessoa agiu e nunca QUAL. Com a troca de
 * comando virando linha da timeline, "Transferiu a conversa · Você/time" seria a
 * resposta errada para a pergunta que a entrega existe para responder.
 */
const ACTIVITY_COLS =
  "id, type, source_module, performed_at, payload, reason, actor_kind, performed_by_user_id";
/**
 * Passo 4 do cap. 5 — a DEMANDA chega ao lugar onde o humano atende.
 *
 * O painel mostrava negócios, pedidos e histórico. Nenhum dos três responde à
 * pergunta que a pessoa do outro lado está fazendo: **o que ela pediu e ainda
 * não foi resolvido.** Lead é o negócio; conversa é o canal; demanda é o que
 * precisa acabar (doutrina cap. 5).
 *
 * O caso concreto que isto evita: o atendente encerra a conversa, a demanda
 * segue aberta e sem próximo passo, e o vazamento só aparece depois — como
 * número numa métrica que ele não abre. `proximo_passo` vem junto porque a
 * ausência dele é o próprio invariante 4, e é o que precisa saltar na tela.
 */
const DEMANDA_COLS =
  "id, revision, aberta_em, origem, estado, proximo_passo, proximo_passo_em, prazo_em";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: contactId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const { data: contactScope, error: scopeError } = await supabase
    .from("contacts")
    .select("organization_id, is_anonymized")
    .eq("id", contactId)
    .maybeSingle();
  if (scopeError) return fail("internal_error", scopeError.message, 500, { requestId });
  if (!contactScope) return fail("not_found", "Contato não encontrado.", 404, { requestId });
  const [canReadProspecting, canReadNuvemshop] = await Promise.all([
    managedAreaAllowedForActor(contactScope.organization_id, user.id, "/app/prospecting"),
    managedAreaAllowedForActor(
      contactScope.organization_id,
      user.id,
      "/app/integrations/nuvemshop",
    ),
  ]);
  // Candidates are worker-only. Authorize the contact through RLS first, then
  // scope this read to that exact contact and organization. Never expose raw data.
  const enrichment = await (async () => {
    if (contactScope.is_anonymized || !canReadProspecting)
      return { enrichment: null, enrichment_error: false };
    try {
      const result = await createAdminClient()
        .from("prospecting_candidates")
        .select("data, created_at")
        .eq("organization_id", contactScope.organization_id)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (result.error) return { enrichment: null, enrichment_error: true };
      if (!result.data) return { enrichment: null, enrichment_error: false };
      const parsed = prospectEnrichmentSchema.safeParse(result.data.data);
      return parsed.success
        ? {
            enrichment: { ...parsed.data, collected_at: result.data.created_at },
            enrichment_error: false,
          }
        : { enrichment: null, enrichment_error: true };
    } catch {
      return { enrichment: null, enrichment_error: true };
    }
  })();
  const pipelines = await supabase
    .from("operational_crm_pipelines")
    .select("id, name, settings")
    .eq("organization_id", contactScope.organization_id)
    .eq("is_archived", false);
  if (pipelines.error) return fail("internal_error", pipelines.error.message, 500, { requestId });
  const pipelineIds = (pipelines.data ?? []).map((pipeline) => pipeline.id);
  const [leads, orders, activities, demandas, fatos, historico] = await Promise.all([
    pipelineIds.length
      ? supabase
          .from("crm_leads")
          .select(LEAD_COLS)
          .eq("contact_id", contactId)
          .eq("organization_id", contactScope.organization_id)
          .in("pipeline_id", pipelineIds)
          .order("updated_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [], error: null }),
    canReadNuvemshop
      ? supabase
          .from("orders")
          .select(ORDER_COLS)
          .eq("contact_id", contactId)
          .eq("organization_id", contactScope.organization_id)
          .order("created_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [], error: null }),
    // 12 e não 5. A janela de 5 foi dimensionada quando a timeline não recebia
    // troca de comando: agora um atendimento normal (assumiu → transferiu →
    // liberou → voltou ao automático) gasta QUATRO linhas sozinho, e com 5 o
    // painel mostraria só a movimentação de dono, empurrando para fora o que o
    // negócio fez. 12 cabe sem rolagem própria na coluna de 296px.
    supabase
      .from("crm_lead_activities")
      .select(ACTIVITY_COLS)
      .eq("contact_id", contactId)
      .eq("organization_id", contactScope.organization_id)
      .order("performed_at", { ascending: false })
      .limit(12),
    // Só as ABERTAS: demanda encerrada é histórico e já vive na timeline. Da
    // mais antiga para a mais nova — quem espera há mais tempo aparece primeiro,
    // mesma régua do Radar, para as duas telas não contarem histórias
    // diferentes sobre o mesmo contato.
    supabase
      .from("demandas")
      .select(DEMANDA_COLS)
      .eq("contact_id", contactId)
      .eq("organization_id", contactScope.organization_id)
      .is("fechada_em", null)
      .order("aberta_em", { ascending: true })
      .limit(5),
    supabase
      .from("lead_notes")
      .select("id, headline, body")
      .eq("contact_id", contactId)
      .eq("organization_id", contactScope.organization_id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("demandas")
      .select("id, desfecho, fechada_em")
      .eq("contact_id", contactId)
      .eq("organization_id", contactScope.organization_id)
      .not("fechada_em", "is", null)
      .order("fechada_em", { ascending: false })
      .limit(5),
  ]);

  // A falha SOBE. Engolir aqui devolveria lista vazia ao cliente e recriaria,
  // do lado do servidor, exatamente a mentira que esta rota veio desfazer.
  const falha =
    leads.error ??
    orders.error ??
    activities.error ??
    demandas.error ??
    fatos.error ??
    historico.error;
  if (falha) {
    return fail("internal_error", falha.message, 500, { requestId });
  }
  const leadRows = (leads.data ?? []) as Record<string, unknown>[];
  const stageIds = leadRows
    .map((lead) => lead.stage_id)
    .filter((id): id is string => typeof id === "string");
  const stages = stageIds.length
    ? await supabase
        .from("operational_crm_stages")
        .select("id, name")
        .eq("organization_id", contactScope.organization_id)
        .in("id", stageIds)
    : { data: [], error: null };
  if (stages.error) return fail("internal_error", stages.error.message, 500, { requestId });
  const pipelinesById = new Map((pipelines.data ?? []).map((pipeline) => [pipeline.id, pipeline]));
  const stagesById = new Map((stages.data ?? []).map((stage) => [stage.id, stage.name]));

  // QUEM agiu, e não só "uma pessoa". O lookup roda sobre os autores DISTINTOS
  // da janela (12 linhas, quase sempre 1 ou 2 pessoas), e degrada declarado
  // quando não há service role — a tela cai no rótulo genérico que ela já usava.
  const linhas = (activities.data ?? []) as Array<{
    performed_by_user_id?: string | null;
    [k: string]: unknown;
  }>;
  const nomes = await nomesDosAtendentes(linhas.map((a) => a.performed_by_user_id ?? null));

  return ok(
    {
      ...enrichment,
      leads: leadRows.map((row) => comCamposDoFunil(row, pipelinesById, stagesById)),
      orders: orders.data ?? [],
      activities: linhas.map((a) => ({
        ...a,
        performed_by_name: a.performed_by_user_id
          ? (nomes.get(a.performed_by_user_id) ?? null)
          : null,
      })),
      demandas: demandas.data ?? [],
      fatos: fatos.data ?? [],
      historico: historico.data ?? [],
    },
    { requestId },
  );
}

function comCamposDoFunil(
  lead: Record<string, unknown>,
  pipelines: ReadonlyMap<string, { name: string; settings: unknown }>,
  stages: ReadonlyMap<string, string>,
) {
  const pipeline = pipelines.get(String(lead.pipeline_id));
  return {
    ...lead,
    field_defs: camposDoFunil(pipeline?.settings as Record<string, unknown> | null),
    funil_nome: pipeline?.name ?? null,
    etapa_nome: stages.get(String(lead.stage_id)) ?? null,
  };
}
