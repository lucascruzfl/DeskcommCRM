/** Read-model canônico do cartão do Jev, compartilhado com MCP. Nenhuma escrita.
 * Os limites de amostra e os agregados mantêm a semântica da v1.69. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { camadasEfetivas } from "@/lib/agent-engine/guardrails/camadas-da-org";
import { haQuemAtendaAOrganizacao } from "@/lib/ai/agents/quem-atende-a-sessao";
import { credencialEmUsoPeloJev, PROVEDOR_DO_JEV } from "./credencial";
import { lerConfigDoJev, type ConfigDoJev } from "./config";
import { CHAVES_DO_CLIMA, type MotorDoClima } from "./metadados-do-clima";
import {
  estadoAoLigar,
  estadoEfetivoDaTarefa,
  rotuloDaChamadaDoJev,
  TAREFA_DO_CLIMA,
  TAREFAS_DO_JEV,
  tarefaEhNova,
  algumFluxoQueClassifica,
  algumRoteadorQuePergunta,
  INSCRICAO_ENCERRADA,
  TAREFA_DA_MANIPULACAO,
  tarefaSemAtendente,
  tarefaSemCamada,
  tarefaSemFluxo,
  tarefaSemRoteador,
  tarefaPodeDecidir,
  type SemAtendente,
} from "./tarefas";
import { CODIGOS_SEM_REDE, O_QUE_FAZER_DO_JEV } from "./textos";
import { DEFAULT_CLASSIFIER_MODEL } from "@/lib/ai/gateway";
import { resolverModeloDoPonto } from "@/lib/ai/gateway-binding";
import { REFERENCIAS_DE_AVISO } from "@/lib/ai/inbox-destino";
import { PROVEDORES_DE_DECISAO } from "@/lib/ai/pontos/provedores";
import { DEFAULT_SENTIMENT_THRESHOLD } from "@/lib/ai/prompts/sentiment";
import { logger } from "@/lib/logger";
import { aiDispatchModeSchema } from "@/lib/schemas/settings";

export class JevReadError extends Error {
  constructor() {
    super("jev_status_read_failed");
  }
}

const [JEV] = PROVEDORES_DE_DECISAO;

const DIAS_DOS_NUMEROS = 7;
const DIAS_DA_CONCORDANCIA = 30;
const MENSAGENS_COMPARADAS_MAX = 500;
/** Quantas conversas o cartão oferece por tarefa em cascata — as mais recentes. */
const CONVERSAS_PERCEBIDAS_MAX = 5;
/** O teto de linhas por resposta do PostgREST (`max_rows` em `supabase/config.toml`). */
const PAGINA = 1000;
// ponytail: 50 páginas = 50 mil execuções do Jev numa semana; acima disso os
// números saem das primeiras 50 mil da janela. Um agregado em SQL (RPC, com
// migration) é o passo seguinte, quando alguma instalação chegar lá.
const PAGINAS_MAX = 50;

/**
 * Os pontos em que o Jev trabalha, no formato da onda 1. O cartão desta versão
 * lê `por_tarefa`; este campo fica para a página da imagem anterior, aberta
 * durante uma atualização ou um rollback, que ainda o lê.
 */
const TAREFAS = TAREFAS_DO_JEV.flatMap((t) =>
  t.ponto ? [{ id: t.ponto, rotulo: t.rotulo, oQueOJevFaz: t.oQueFaz }] : [],
);

type Concordancia = {
  dias: number;
  comparadas: number;
  concordaram: number;
  /**
   * Só o clima: a conta saiu das `MENSAGENS_COMPARADAS_MAX` mais recentes, e
   * não do período inteiro. Sem isto, lado a lado com as outras tarefas (que
   * contam os 30 dias no banco), "X de 500" lia-se como "o Jev mediu o clima em
   * menos mensagens".
   */
  teto_da_amostra?: number;
  /**
   * Só a manipulação: em quantas das comparadas SÓ o Jev deu o alerta forte.
   * É o que decidir muda nela (o maior dos dois vale), e a concordância exata
   * de três níveis, dominada por "nenhum" dos dois lados, não mostra isso.
   */
  so_o_jev_alto?: number;
};

/**
 * O que o cartão mostra de uma tarefa em cascata: em quantas MENSAGENS o Jev
 * percebeu o pedido que a regra de hoje não reconheceu (a resposta dele passou
 * do corte), e as conversas mais recentes delas. A unidade é a mensagem — uma
 * linha de `jev_observacoes` por mensagem —, e não o pedido: o worker pergunta
 * no `message.received`, antes da janela do turno, então duas frases naturais
 * na mesma rajada contam duas, e a frase natural que chega antes de um pedido
 * que a regra pega na mensagem seguinte conta uma. Por mensagem, as duas são
 * verdade. O link sai pronto daqui: o navegador nunca monta endereço a partir
 * de uma referência solta.
 */
type Percebidos = {
  dias: number;
  mensagens: number;
  conversas: Array<{ href: string; em: string }>;
};

function porTarefa(
  c: ConfigDoJev,
  observacao: Readonly<Record<string, Concordancia>>,
  percebidos: Readonly<Record<string, Percebidos>>,
  camadas: ReturnType<typeof camadasEfetivas>,
  temRoteadorQuePergunta: boolean,
  semAtendente: SemAtendente | null,
  temFluxoQueClassifica: boolean,
) {
  return TAREFAS_DO_JEV.map((t) => ({
    id: t.id,
    ponto: t.ponto ?? null,
    rotulo: t.rotulo,
    oQueFaz: t.oQueFaz,
    estado: estadoEfetivoDaTarefa(c, t),
    ao_ligar: estadoAoLigar(c, t),
    novo: tarefaEhNova(c, t),
    so_observa: !tarefaPodeDecidir(t),
    pode_decidir: tarefaPodeDecidir(t),
    observacao: observacao[t.id] ?? null,
    percebidos: percebidos[t.id] ?? null,
    // A camada de segurança que ela acompanha está desligada: o turno não
    // pergunta, e "observando" sem mais nada prometeria uma comparação que nunca vem.
    sem_camada: tarefaSemCamada(t, camadas),
    // Sem roteador ativo que o Jev possa perguntar (nenhum, ou sem intenções, ou
    // com mais do que cabe), "observando" prometeria uma comparação que nunca vem.
    sem_roteador: tarefaSemRoteador(t, temRoteadorQuePergunta),
    // As de pedido, onde o atendimento automático não roda em número nenhum: o
    // worker nunca as pergunta, e "Só observa" com "percebeu 0" mentiria.
    sem_atendente: tarefaSemAtendente(t, semAtendente),
    // A do follow-up sem follow-up publicado com o passo "Classificar (IA)":
    // ninguém lê a resposta, e "observando" esperaria uma comparação que não vem.
    sem_fluxo: tarefaSemFluxo(t, temFluxoQueClassifica),
  }));
}

interface LinhaDaSemana {
  /** O ponto de cada tarefa — a falha de uma só se supera com a medida da MESMA. */
  purpose: string;
  provider: string;
  status: string;
  origem_da_escolha: string | null;
  error_code: string | null;
  cost_cents: number | null;
  latency_ms: number | null;
  created_at: string;
}

/** Linhas do Jev (as dele e as da reserva que o cobriu), em ordem de criação. */
function numerosDaSemana(linhas: readonly LinhaDaSemana[]) {
  const doJev = linhas.filter((l) => l.provider === PROVEDOR_DO_JEV);
  const medidas = doJev.filter((l) => l.status === "ok");
  const latencias = medidas.flatMap((l) => (l.latency_ms === null ? [] : [l.latency_ms]));
  // Linha sem preço (`null`, versão que o fornecedor devolveu fora da tabela)
  // fica fora da soma e AVISA que a soma está incompleta; sem nenhuma linha com
  // preço, o custo é desconhecido (`null`), como no SUM do SQL — nunca um zero
  // inventado ao lado de N medições.
  const comPreco = doJev.filter((l) => l.cost_cents !== null);
  const custo =
    comPreco.length === 0 && doJev.length > 0
      ? null
      : comPreco.reduce((soma, l) => soma + Number(l.cost_cents), 0);
  const custoIncompleto = comPreco.length < doJev.length;
  // A mais recente pela DATA, não pela posição: a ordem da leitura existe para
  // a paginação, e mudar a ordem não pode trocar a falha que o cartão mostra.
  const maisNova = (atual: LinhaDaSemana | null, l: LinhaDaSemana) =>
    atual === null || Date.parse(l.created_at) > Date.parse(atual.created_at) ? l : atual;
  // Só a falha que o Jev ainda não superou NAQUELA tarefa (D3: só alarma o que
  // pede ação). Um 429 passageiro seguido de mil medidas não é notícia pela
  // semana inteira; mas a medida do clima não supera a pergunta da manipulação
  // que a API recusa (o disjuntor dessa falha é por tarefa).
  const ultimaMedida = new Map<string, number>();
  for (const m of medidas) {
    ultimaMedida.set(
      m.purpose,
      Math.max(ultimaMedida.get(m.purpose) ?? 0, Date.parse(m.created_at)),
    );
  }
  const naoSuperada = (f: LinhaDaSemana) =>
    Date.parse(f.created_at) > (ultimaMedida.get(f.purpose) ?? 0);
  // A cobertura em que nada saiu para a rede (sem chave, disjuntor aberto) não
  // é falha nova: tomaria o lugar da que abriu o disjuntor, que diz o que fazer.
  const falha = doJev
    .filter(
      (l) => l.status === "erro" && naoSuperada(l) && !CODIGOS_SEM_REDE.has(l.error_code ?? ""),
    )
    .reduce<LinhaDaSemana | null>(maisNova, null);
  return {
    numeros: {
      dias: DIAS_DOS_NUMEROS,
      decisoes: medidas.length,
      custo_cents: custo,
      custo_incompleto: custoIncompleto,
      latencia_media_ms:
        latencias.length === 0
          ? null
          : Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length),
      // Só a que MEDIU: a reserva que também falhou não assumiu nada. No
      // clima, a linha é a da IA de sempre (`ok`); no roteador decidindo, é a
      // linha de erro do Jev (`lib/ai/decisao/roteador.ts`), gravada só quando
      // a IA de sempre respondeu.
      reservas: linhas.filter(
        (l) =>
          l.origem_da_escolha === "reserva_do_jev" &&
          (l.status === "ok" || l.provider === PROVEDOR_DO_JEV),
      ).length,
    },
    // A tarefa, e não só o motivo: com três tarefas e um disjuntor por tarefa,
    // "a pergunta foi recusada" não dizia qual parou.
    ultima_falha: falha
      ? {
          motivo: falha.error_code,
          em: falha.created_at,
          tarefa: rotuloDaChamadaDoJev(falha.purpose),
        }
      : null,
  };
}

/**
 * A nota chamaria uma pessoa? O corte é `DEFAULT_SENTIMENT_THRESHOLD`
 * (`lib/ai/prompts/sentiment.ts:34`), o mesmo que `workers/ai-sentiment-worker.ts`
 * compara (`score < threshold`) para emitir `ai.sentiment_alert`.
 * ponytail: o limiar por agente (`config.sentiment_threshold`) não entra — não
 * tem tela que o grave hoje. Se ganhar, o worker passa a gravar o limiar usado
 * em `messages.metadata` e a conta lê de lá.
 */
const abaixo = (n: number) => n < DEFAULT_SENTIMENT_THRESHOLD;

/**
 * Concordância em observação: as duas notas caíram do MESMO LADO do corte que
 * decide a passagem para humano? É a pergunta que importa antes de deixar o Jev
 * decidir — "chamou uma pessoa quando a IA de sempre chamaria".
 */
function concordancia(
  linhas: ReadonlyArray<{ nota: unknown; nota_do_jev: unknown }>,
): Concordancia {
  const pares = linhas.flatMap((l) =>
    typeof l.nota === "number" && typeof l.nota_do_jev === "number"
      ? [[l.nota, l.nota_do_jev] as const]
      : [],
  );
  return {
    dias: DIAS_DA_CONCORDANCIA,
    comparadas: pares.length,
    concordaram: pares.filter(([ia, jev]) => abaixo(ia) === abaixo(jev)).length,
  };
}

/**
 * "Clientes irritados percebidos": conversas em que a nota DO JEV ficou abaixo
 * do corte da passagem para humano. A nota dele, e não a que decidiu: em
 * observação quem decide é a IA de sempre, e o número do cartão ficaria em zero
 * enquanto o Jev percebe a irritação do mesmo jeito. Conversa, e não mensagem:
 * o cliente irritado que manda três mensagens é um cliente.
 */
function irritadosPercebidos(
  linhas: ReadonlyArray<{ conversa: unknown; nota_do_jev: unknown }>,
): number {
  return new Set(
    linhas.flatMap((l) =>
      typeof l.nota_do_jev === "number" && abaixo(l.nota_do_jev) ? [l.conversa] : [],
    ),
  ).size;
}

function configPublica(c: ConfigDoJev) {
  return { ligado: c.ligado, modo: c.modo, aceite: c.aceite };
}

function diasAtras(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
}

export async function lerEstadoDoJev(db: SupabaseClient, orgId: string) {
  const lerSemana = async (): Promise<{ linhas: LinhaDaSemana[]; erro: string | null }> => {
    const linhas: LinhaDaSemana[] = [];
    const desde = diasAtras(DIAS_DOS_NUMEROS);
    for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
      const { data, error } = await db
        .from("llm_calls")
        .select(
          "purpose, provider, status, origem_da_escolha, error_code, cost_cents, latency_ms, created_at",
        )
        .eq("organization_id", orgId)
        .gte("created_at", desde)
        .or(`provider.eq.${PROVEDOR_DO_JEV},origem_da_escolha.eq.reserva_do_jev`)
        // CRESCENTE de propósito: na paginação por posição, a linha que entra
        // durante a leitura cai no fim, e nenhuma página anterior se desloca.
        .order("created_at", { ascending: true })
        .range(pagina * PAGINA, (pagina + 1) * PAGINA - 1);
      if (error) return { linhas, erro: error.message };
      linhas.push(...(data ?? []));
      if ((data ?? []).length < PAGINA) break;
    }
    return { linhas, erro: null };
  };

  /**
   * A concordância das tarefas que gravam em `jev_observacoes` — todas menos o
   * clima, que a guarda nas notas das mensagens desde a onda 1. Contagem no
   * banco (`head`), sem trazer linha: "sem par" (`concordou` nulo, a IA de
   * sempre não decidiu) não entra no denominador.
   */
  const lerObservacoes = async (): Promise<{
    porTarefa: Record<string, Concordancia>;
    erro: string | null;
  }> => {
    const desde = diasAtras(DIAS_DA_CONCORDANCIA);
    const contar = (tarefa: string) =>
      db
        .from("jev_observacoes")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("tarefa", tarefa)
        .gte("created_at", desde);
    const porTarefa: Record<string, Concordancia> = {};
    // As em cascata não têm concordância: por construção, a regra de hoje disse
    // não em toda mensagem em que o Jev foi perguntado (`lerPercebidos`).
    for (const t of TAREFAS_DO_JEV.filter(
      (x) => x.id !== TAREFA_DO_CLIMA.id && x.familia !== "cascata",
    )) {
      const daManipulacao = t.id === TAREFA_DA_MANIPULACAO.id;
      const [comparadas, concordaram, soDoJev] = await Promise.all([
        contar(t.id).not("concordou", "is", null),
        contar(t.id).eq("concordou", true),
        // `neq` também deixa de fora o "sem par" (`rotulo_atual` nulo).
        daManipulacao ? contar(t.id).eq("rotulo_jev", "high").neq("rotulo_atual", "high") : null,
      ]);
      const erro =
        comparadas.error?.message ?? concordaram.error?.message ?? soDoJev?.error?.message;
      if (erro) return { porTarefa, erro };
      porTarefa[t.id] = {
        dias: DIAS_DA_CONCORDANCIA,
        comparadas: comparadas.count ?? 0,
        concordaram: concordaram.count ?? 0,
        ...(soDoJev ? { so_o_jev_alto: soDoJev.count ?? 0 } : {}),
      };
    }
    return { porTarefa, erro: null };
  };

  /**
   * As tarefas em cascata: as mensagens em que o Jev percebeu o pedido (passou
   * do corte) nos últimos 30 dias, contadas no banco, e as conversas das mais
   * recentes. ponytail: as conversas saem das 50 linhas mais recentes; com mais
   * de 50 mensagens seguidas da mesma conversa, as outras só aparecem depois.
   */
  const lerPercebidos = async (): Promise<{
    porTarefa: Record<string, Percebidos>;
    erro: string | null;
  }> => {
    const desde = diasAtras(DIAS_DA_CONCORDANCIA);
    const doJev = (tarefa: string) =>
      db
        .from("jev_observacoes")
        .select("conversation_id, created_at", { count: "exact" })
        .eq("organization_id", orgId)
        .eq("tarefa", tarefa)
        .eq("rotulo_jev", "sim")
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(50);
    const porTarefa: Record<string, Percebidos> = {};
    for (const t of TAREFAS_DO_JEV.filter((x) => x.familia === "cascata")) {
      const { data, count, error } = await doJev(t.id);
      if (error) return { porTarefa, erro: error.message };
      const conversas: Percebidos["conversas"] = [];
      const vistas = new Set<string>();
      for (const linha of data ?? []) {
        if (linha.conversation_id === null || vistas.has(linha.conversation_id)) continue;
        vistas.add(linha.conversation_id);
        conversas.push({
          href: REFERENCIAS_DE_AVISO.conversation.href(linha.conversation_id),
          em: linha.created_at,
        });
        if (conversas.length === CONVERSAS_PERCEBIDAS_MAX) break;
      }
      porTarefa[t.id] = { dias: DIAS_DA_CONCORDANCIA, mensagens: count ?? 0, conversas };
    }
    return { porTarefa, erro: null };
  };

  /**
   * Há quem atenda, sem pausa, em algum número da organização? — o portão que
   * o worker pergunta antes dos pedidos, sem fixar o número. `null` quando não
   * deu para saber (sem `SUPABASE_DB_URL`, o banco fora): aí o cartão não
   * afirma "Não roda" — dizer que algo está parado sem ter lido mandaria a
   * pessoa consertar o que está funcionando.
   */
  const lerQuemAtende = async (): Promise<boolean | null> => {
    try {
      return await haQuemAtendaAOrganizacao(getRequestPool(), orgId);
    } catch (erro) {
      logger.warn("[ai/jev] não deu para saber se há quem atenda na organização", {
        organization_id: orgId,
        erro: erro instanceof Error ? erro.name : typeof erro,
      });
      return null;
    }
  };

  const [
    orgRes,
    credsRes,
    semana,
    comparadasRes,
    iaDeSempre,
    percebidasRes,
    observacoes,
    percebidos,
    camadasRes,
    roteadoresRes,
    haQuemAtenda,
    fluxosRes,
    versoesEmCursoRes,
  ] = await Promise.all([
    db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
    db
      .from("ai_provider_credentials")
      .select("id, label, provider, is_active, validated_at, validation_error, created_at")
      .eq("organization_id", orgId)
      .eq("provider", PROVEDOR_DO_JEV)
      .eq("is_active", true),
    lerSemana(),
    // ponytail: `messages` não tem índice por (organização, data) — o plano lê
    // as mensagens da organização e filtra. Índice parcial em
    // `metadata ? 'sentiment_jev_score'` (migration) quando pesar.
    db
      .from("messages")
      .select(
        `nota:metadata->${CHAVES_DO_CLIMA.nota}, nota_do_jev:metadata->${CHAVES_DO_CLIMA.notaDoJev}`,
      )
      .eq("organization_id", orgId)
      .gte("created_at", diasAtras(DIAS_DA_CONCORDANCIA))
      .eq(`metadata->>${CHAVES_DO_CLIMA.motor}`, "llm" satisfies MotorDoClima)
      .not(`metadata->${CHAVES_DO_CLIMA.notaDoJev}`, "is", null)
      .order("created_at", { ascending: false })
      .limit(MENSAGENS_COMPARADAS_MAX),
    // A MESMA pergunta que o worker faz antes de medir: sem ela, o cartão diria
    // "a IA de sempre é a reserva" numa empresa em que ninguém a resolve.
    resolverModeloDoPonto("sentiment_classify", orgId, DEFAULT_CLASSIFIER_MODEL, {
      naFaltaUsarOPadraoDaOrganizacao: true,
    }),
    // ponytail: uma página (1000 mensagens medidas pelo Jev na semana); acima
    // disso a conta sai das mais recentes. O agregado em SQL é o passo seguinte.
    db
      .from("messages")
      .select(`conversa:conversation_id, nota_do_jev:metadata->${CHAVES_DO_CLIMA.notaDoJev}`)
      .eq("organization_id", orgId)
      .gte("created_at", diasAtras(DIAS_DOS_NUMEROS))
      .not(`metadata->${CHAVES_DO_CLIMA.notaDoJev}`, "is", null)
      .order("created_at", { ascending: false })
      .limit(PAGINA),
    lerObservacoes(),
    lerPercebidos(),
    db.from("org_guardrail_layers").select("layer, enabled").eq("organization_id", orgId),
    // Com a contagem das intenções: o roteador ativo sem nenhuma (o estado logo
    // depois de criar um) ou com mais do que cabe nunca é perguntado ao Jev.
    db
      .from("ai_routers")
      .select("id, intencoes:ai_router_members(count)")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("intencoes.organization_id", orgId),
    lerQuemAtende(),
    // Os follow-ups publicados, com o grafo da versão ativa: é nele que se vê o
    // passo "Classificar (IA)" (`algumFluxoQueClassifica`).
    db
      .from("followup_flow_pointers")
      .select("versao:followup_flow_versions!followup_flow_pointers_active_version_id_fkey(graph)")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .eq("versao.organization_id", orgId),
    // E as versões em que alguma inscrição ainda anda: o motor as leva ao passo
    // mesmo com o follow-up desativado ou republicado sem ele — e cada resposta
    // vai ao Jev. Sem elas, o cartão diria "Não roda" com dados saindo.
    // ponytail: o `!inner` procura a inscrição viva por versão, sem índice em
    // `version_id`; se pesar, um índice parcial nos status vivos.
    db
      .from("followup_flow_versions")
      .select("graph, inscricoes:followup_enrollments!inner(id)")
      .eq("organization_id", orgId)
      .eq("inscricoes.organization_id", orgId)
      .not("inscricoes.status", "in", INSCRICAO_ENCERRADA)
      .limit(1, { referencedTable: "inscricoes" }),
  ]);

  const erro =
    orgRes.error?.message ??
    credsRes.error?.message ??
    semana.erro ??
    comparadasRes.error?.message ??
    percebidasRes.error?.message ??
    observacoes.erro ??
    percebidos.erro ??
    camadasRes.error?.message ??
    roteadoresRes.error?.message ??
    fluxosRes.error?.message ??
    versoesEmCursoRes.error?.message;
  if (erro) throw new JevReadError();

  const credenciais = credsRes.data ?? [];
  const emUso = credencialEmUsoPeloJev(credenciais);
  // Sem nenhuma validada, o cartão mostra a mais recente — é ela que tem o
  // motivo da recusa para explicar.
  const mostrada =
    emUso ??
    [...credenciais].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ??
    null;

  const { numeros, ultima_falha } = numerosDaSemana(semana.linhas);
  const config = lerConfigDoJev(orgRes.data?.settings);
  // O dreno descarta o turno do modo externo antes de tudo (spec 14), e o
  // worker não pergunta os pedidos ali — o mesmo `aiDispatchModeSchema`.
  const externo =
    aiDispatchModeSchema.parse(
      (orgRes.data?.settings as { ai_dispatch_mode?: unknown } | null | undefined)
        ?.ai_dispatch_mode,
    ) === "external";
  const semAtendente: SemAtendente | null = externo
    ? "externo"
    : haQuemAtenda === false
      ? "ninguem_no_ar"
      : null;
  const linhasDoClima = comparadasRes.data ?? [];
  const doClima: Concordancia = {
    ...concordancia(linhasDoClima),
    ...(linhasDoClima.length >= MENSAGENS_COMPARADAS_MAX
      ? { teto_da_amostra: MENSAGENS_COMPARADAS_MAX }
      : {}),
  };

  return {
    provedor: {
      rotulo: JEV.rotulo,
      quandoUsar: JEV.quandoUsar,
      ondePegarAChave: JEV.ondePegarAChave,
      prefixoDaChave: JEV.prefixoDaChave,
    },
    chave: {
      existe: mostrada !== null,
      validada: emUso !== null,
      credencial_id: mostrada?.id ?? null,
      rotulo: mostrada?.label ?? null,
      erro_de_validacao: mostrada?.validation_error ?? null,
    },
    config: configPublica(config),
    tarefas: TAREFAS,
    por_tarefa: porTarefa(
      config,
      { ...observacoes.porTarefa, [TAREFA_DO_CLIMA.id]: doClima },
      percebidos.porTarefa,
      camadasEfetivas(camadasRes.data ?? []),
      algumRoteadorQuePergunta(roteadoresRes.data ?? []),
      semAtendente,
      algumFluxoQueClassifica([
        ...(fluxosRes.data ?? []),
        ...(versoesEmCursoRes.data ?? []).map((versao) => ({ versao })),
      ]),
    ),
    tem_ia_de_sempre: iaDeSempre !== null,
    numeros: {
      ...numeros,
      irritados: irritadosPercebidos(percebidasRes.data ?? []),
      observacao: doClima,
    },
    ultima_falha,
  };
}

/** Projeção administrativa MCP: só estado e agregados. Nunca retorna o aceite,
 * rótulo/erro de credencial, links de conversas, mensagens, grafos ou erro cru. */
export function estadoDoJevParaMcp(model: Awaited<ReturnType<typeof lerEstadoDoJev>>) {
  const failure = model.ultima_falha;
  const reason =
    failure?.motivo && Object.hasOwn(O_QUE_FAZER_DO_JEV, failure.motivo)
      ? failure.motivo
      : failure
        ? "jev_falha"
        : null;
  return {
    config: {
      ligado: model.config.ligado,
      modo: model.config.modo,
      aceite_registrado: model.config.aceite !== null,
    },
    chave: {
      existe: model.chave.existe,
      validada: model.chave.validada,
      falha_validacao: model.chave.erro_de_validacao !== null,
    },
    por_tarefa: model.por_tarefa.map((task) => ({
      id: task.id,
      ponto: task.ponto,
      rotulo: task.rotulo,
      estado: task.estado,
      ao_ligar: task.ao_ligar,
      novo: task.novo,
      so_observa: task.so_observa,
      pode_decidir: task.pode_decidir,
      sem_camada: task.sem_camada,
      sem_roteador: task.sem_roteador,
      sem_atendente: task.sem_atendente,
      sem_fluxo: task.sem_fluxo,
      observacao: task.observacao,
      percebidos: task.percebidos
        ? { dias: task.percebidos.dias, mensagens: task.percebidos.mensagens }
        : null,
    })),
    tem_ia_de_sempre: model.tem_ia_de_sempre,
    numeros: model.numeros,
    ultima_falha: failure ? { motivo: reason, em: failure.em, tarefa: failure.tarefa } : null,
  };
}
