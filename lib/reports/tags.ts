/** Relatório canônico por etiqueta, compartilhado pelo HTTP (sessão/RLS) e MCP (manager). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/types";
import { STATUS_ENCERRADOS } from "@/lib/inbox/comando-da-conversa";
import { fusoValido } from "@/lib/reports/atividades";

/**
 * Quantos dias a janela pode cobrir. Mesma ordem de grandeza de
 * `/reports/activities` (90): sem migração a leitura varre linhas, e um "desde
 * sempre" chegaria pela query string de qualquer um.
 */
const DIAS_MAXIMOS = 90;

/**
 * `max_rows = 1000` é o teto do SERVIDOR — um `.limit(5000)` devolve 1000 e não
 * diz nada. Só `range` com `count` exato sabe o tamanho de verdade.
 */
const TAMANHO_DA_PAGINA = 1000;
const PAGINAS_MAXIMAS = 10;
const MAXIMO_DE_TAGS_PEDIDAS = 100;

export const tagsReportQuerySchema = z.object({
  // `iso.date` confere o CALENDÁRIO, não só o formato: `2026-99-99` passava no
  // regex, dava `NaN` dias, furava o teto de 90 e virava janela até 2034.
  de: z.iso.date({ message: "Data inicial inválida." }).optional(),
  ate: z.iso.date({ message: "Data final inválida." }).optional(),
  /**
   * Fuso de quem lê. A janela é DIÁRIA no fuso do leitor, e sem o fuso ela é
   * diária em UTC: `?de=2026-09-01&tz=America/Sao_Paulo` começa à meia-noite de
   * Brasília (03:00Z), e sem `tz` à meia-noite UTC — três horas de conversa
   * nascem ou desaparecem conforme o país de quem olha.
   */
  tz: z.string().min(1).max(64).default("UTC").refine(fusoValido, {
    message: "Fuso horário desconhecido.",
  }),
  tags: z.string().max(4000).optional(),
});

interface ConversaBruta {
  id: string;
  organization_id: string;
  tags: string[] | null;
  status: string;
  created_at: string;
  service_started_at: string | null;
  service_closed_at: string | null;
  awaiting_since: string | null;
  last_outbound_at: string | null;
}

/** O que a rota entrega por etiqueta — invariante 5: volume, espera, desfecho. */
interface LinhaDeEtiqueta {
  etiqueta: string;
  conversas: number;
  abertas: number;
  resolvidas: number;
  /** `null` = nenhuma conversa da etiqueta tinha espera mensurável. */
  espera_media_segundos: number | null;
  /** 0–100, já arredondado — a barra não recalcula nem inventa denominador. */
  fatia: number;
}

export async function getTagsReportHandler(
  supabase: SupabaseClient,
  organizationId: string,
  raw: unknown,
  requestId: string,
) {
  const parsed = tagsReportQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "validation_failed",
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      requestId,
      "Query inválida.",
    );
  }
  const { tz } = parsed.data;
  const hoje = dataNoFuso(new Date(), tz);
  const deTexto = parsed.data.de ?? `${hoje.slice(0, 7)}-01`;
  const ateTexto = parsed.data.ate ?? hoje;

  if (deTexto > ateTexto) {
    // Invertido devolveria lista vazia, e lista vazia lê como "não houve
    // atendimento" — a resposta errada mais convincente que este relatório dá.
    throw new ApiError(
      422,
      "validation_failed",
      undefined,
      requestId,
      "A data inicial é depois da final.",
    );
  }
  const dias = diasDeJanela(deTexto, ateTexto);
  if (dias > DIAS_MAXIMOS) {
    throw new ApiError(
      422,
      "validation_failed",
      undefined,
      requestId,
      `Janela de ${dias} dias: o relatório por etiqueta cobre no máximo ${DIAS_MAXIMOS}.`,
    );
  }

  const pedidas = etiquetasPedidas(parsed.data.tags);
  if (pedidas.length > MAXIMO_DE_TAGS_PEDIDAS) {
    throw new ApiError(
      422,
      "validation_failed",
      undefined,
      requestId,
      `Muitas etiquetas pedidas (${pedidas.length}): o teto é ${MAXIMO_DE_TAGS_PEDIDAS}.`,
    );
  }

  // Semiaberta [de, até): o fim é o começo do dia SEGUINTE, para "ate=hoje"
  // incluir as conversas de hoje inteiras.
  const janela = {
    de: inicioDoDia(deTexto, tz).toISOString(),
    ate: inicioDoDia(proximoDia(ateTexto), tz).toISOString(),
  };

  // ─── A DIMENSÃO ────────────────────────────────────────────────────────────
  //
  // `security invoker` + `p_org` da SESSÃO: quem passa o uuid de outra
  // organização recebe zero linhas pelo banco, sem depender de a rota se
  // comportar. O erro SOBE — engolir devolveria "sem dados" para um problema de
  // leitura, que é a mentira mais cara deste relatório.
  const { data: emUso, error: erroDimensao } = await supabase.rpc("fn_tags_de_conversa_em_uso", {
    p_org: organizationId,
  });
  if (erroDimensao)
    throw new ApiError(500, "internal_error", undefined, requestId, erroDimensao.message);
  const dimensaoDoBanco = ((emUso ?? []) as Array<{ tag: string }>)
    .map((linha) => linha.tag)
    .filter((tag) => typeof tag === "string" && tag.length > 0);

  // ─── AS CONVERSAS DO PERÍODO ───────────────────────────────────────────────
  //
  // A régua é "o ATENDIMENTO começou no período" (`service_started_at`), não
  // `created_at`: a conversa é um fio único por contato e sessão de canal
  // (`uniq_conversations_1to1_per_contact_session`), e quem volta reabre o MESMO
  // fio com `service_started_at` novo e o `created_at` de quando falou pela
  // primeira vez — por `created_at`, a reclamação de setembro de quem conversa
  // desde junho sumiria de setembro. Fio sem atendimento carimbado (grupo, ou
  // conversa que ainda não recebeu mensagem do cliente) cai em `created_at`.
  // Limites declarados: o fio guarda só o ÚLTIMO começo, então um atendimento
  // anterior de um fio reaberto depois do período conta no período da
  // reabertura; e as etiquetas acumulam no fio, não por atendimento.
  // Ordenado DESC: se a leitura for cortada, sobra o período mais RECENTE — um
  // relatório que não completa o corte prefere mentir sobre o passado distante
  // do que sobre a semana que o gestor está olhando.
  const COLUNAS =
    "id, organization_id, tags, status, created_at, service_started_at, service_closed_at, awaiting_since, last_outbound_at";
  const naJanela =
    `and(service_started_at.gte.${janela.de},service_started_at.lt.${janela.ate}),` +
    `and(service_started_at.is.null,created_at.gte.${janela.de},created_at.lt.${janela.ate})`;
  const conversas: ConversaBruta[] = [];
  let totalNoBanco: number | null = null;
  let paginaCheia = false;

  for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
    const inicio = pagina * TAMANHO_DA_PAGINA;
    const { data, error, count } = await supabase
      .from("conversations")
      .select(COLUNAS, { count: "exact" })
      .eq("organization_id", organizationId)
      .or(naJanela)
      .order("service_started_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(inicio, inicio + TAMANHO_DA_PAGINA - 1);
    if (error) throw new ApiError(500, "internal_error", undefined, requestId, error.message);

    if (totalNoBanco === null) totalNoBanco = count;
    const lote = (data ?? []) as unknown as ConversaBruta[];
    conversas.push(...lote);
    paginaCheia = lote.length >= TAMANHO_DA_PAGINA;
    if (!paginaCheia) break;
    if (totalNoBanco !== null && conversas.length >= totalNoBanco) break;
  }
  const truncado = totalNoBanco === null ? paginaCheia : conversas.length < totalNoBanco;

  // ─── A CONTA ───────────────────────────────────────────────────────────────
  const agora = Date.now();
  const porEtiqueta = agregar(conversas, agora);

  const chaves = [...new Set([...dimensaoDoBanco, ...porEtiqueta.keys(), ...pedidas])]
    // Pedido filtra: quem pediu duas etiquetas não quer a lista inteira — mas a
    // pedida que não tem conversa NENHUMA no período continua aqui (zerada).
    .filter((tag) => pedidas.length === 0 || pedidas.includes(tag))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  // O corte: sem linha nenhuma, a resposta DIZ que não há dados. Duas portas
  // para a mesma ausência, e as duas são pergunta, não tabela.
  if (chaves.length === 0) {
    return montarResposta(janela, tz, [], "nenhuma_etiqueta_em_uso", truncado);
  }

  const linhas: LinhaDeEtiqueta[] = chaves.map((etiqueta) => {
    const conta = porEtiqueta.get(etiqueta) ?? zerada();
    return {
      etiqueta,
      conversas: conta.conversas,
      abertas: conta.abertas,
      resolvidas: conta.resolvidas,
      espera_media_segundos:
        conta.medidas > 0 ? Math.round(conta.somaEsperaMs / conta.medidas / 1000) : null,
      fatia: 0,
    };
  });

  const totalEtiquetagens = linhas.reduce((soma, l) => soma + l.conversas, 0);
  if (totalEtiquetagens === 0) {
    return montarResposta(janela, tz, [], "nenhuma_conversa_com_etiqueta_no_periodo", truncado);
  }

  for (const linha of linhas) linha.fatia = fatiaDe(linha.conversas, totalEtiquetagens);
  // O denominador é a SOMA das etiquetagens (uma conversa com duas etiquetas
  // conta em duas linhas), então as fatias somam 100 exatos antes de arredondar
  // — e o arredondamento não pode criar porcentagem que não existe: 101% num
  // relatório é o mesmo defeito de barra que não fecha.
  const excedente = linhas.reduce((soma, l) => soma + l.fatia, 0) - 100;
  if (excedente > 0) {
    const maior = linhas.reduce((a, b) => (a.fatia >= b.fatia ? a : b));
    maior.fatia -= excedente;
  }

  // Volume primeiro: a pergunta é "qual assunto ocupou mais", e a leitura que
  // começa em cima não pode obrigar a varrer a lista para achar o maior.
  linhas.sort((a, b) => b.conversas - a.conversas || a.etiqueta.localeCompare(b.etiqueta, "pt-BR"));

  return montarResposta(janela, tz, linhas, null, truncado);
}

interface Conta {
  conversas: number;
  abertas: number;
  resolvidas: number;
  somaEsperaMs: number;
  medidas: number;
}

function zerada(): Conta {
  return { conversas: 0, abertas: 0, resolvidas: 0, somaEsperaMs: 0, medidas: 0 };
}

/**
 * Uma conversa de duas etiquetas conta em DUAS linhas: a pergunta é "deste
 * assunto, quantas", e suprimir a segunda mentiria o volume dela para beneficiar
 * o total. É por isso que o denominador de `fatia` é a soma das linhas.
 */
function agregar(conversas: ConversaBruta[], agora: number): Map<string, Conta> {
  const mapa = new Map<string, Conta>();
  for (const conversa of conversas) {
    const espera = esperaMs(conversa, agora);
    const encerrada = STATUS_ENCERRADOS.has(conversa.status);
    for (const etiqueta of conversa.tags ?? []) {
      if (!etiqueta) continue;
      const conta = mapa.get(etiqueta) ?? zerada();
      conta.conversas += 1;
      if (encerrada) conta.resolvidas += 1;
      else conta.abertas += 1;
      if (espera !== null) {
        conta.somaEsperaMs += espera;
        conta.medidas += 1;
      }
      mapa.set(etiqueta, conta);
    }
  }
  return mapa;
}

/**
 * De `awaiting_since` até `last_outbound_at` quando respondemos depois dela.
 * Sem resposta depois: aberta conta até `agora`; ENCERRADA termina em
 * `service_closed_at` — ou `null` sem ele, nunca `agora`, que faria um período
 * passado mudar a cada recarga. Sem `awaiting_since` não há régua — `null`, não
 * zero. O que `awaiting_since` significa em cada caso está no cabeçalho.
 */
function esperaMs(conversa: ConversaBruta, agora: number): number | null {
  const inicio = instante(conversa.awaiting_since);
  if (inicio === null) return null;
  const fim = instante(conversa.last_outbound_at);
  if (fim !== null && fim >= inicio) return fim - inicio;
  if (!STATUS_ENCERRADOS.has(conversa.status)) return Math.max(0, agora - inicio);
  const encerrada = instante(conversa.service_closed_at);
  return encerrada !== null && encerrada >= inicio ? encerrada - inicio : null;
}

function instante(texto: string | null): number | null {
  if (!texto) return null;
  const ms = Date.parse(texto);
  return Number.isNaN(ms) ? null : ms;
}

function fatiaDe(quantidade: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((quantidade / total) * 100);
}

function montarResposta(
  janela: { de: string; ate: string },
  tz: string,
  linhas: LinhaDeEtiqueta[],
  motivo: string | null,
  truncado: boolean,
) {
  return {
    // A régua junto do número: período e fuso saem junto da conta, porque
    // número sem denominador declarado não muda decisão (03-medida-do-proposito).
    janela: { ...janela, tz },
    linhas,
    total_etiquetagens: linhas.reduce((soma, l) => soma + l.conversas, 0),
    sem_dados: linhas.length === 0,
    motivo,
    truncado,
  };
}

function etiquetasPedidas(brutas: string | undefined): string[] {
  const vistas = new Set<string>();
  for (const pedida of (brutas ?? "").split(",")) {
    const etiqueta = pedida.trim();
    if (etiqueta) vistas.add(etiqueta);
  }
  return [...vistas];
}

/** Dias de calendário cobertos pela janela, contando os dois extremos. */
function diasDeJanela(de: string, ate: string): number {
  const ms = Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

function proximoDia(data: string): string {
  const [ano, mes, dia] = data.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);
}

function partesLocais(
  instante: Date,
  tz: string,
): { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number } {
  const formato = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const partes: Record<string, string> = {};
  for (const parte of formato.formatToParts(instante)) partes[parte.type] = parte.value;
  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour),
    minuto: Number(partes.minute),
    segundo: Number(partes.second),
  };
}

function dataNoFuso(instante: Date, tz: string): string {
  const p = partesLocais(instante, tz);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}`;
}

/**
 * `2026-09-01` em `tz` → o instante UTC do começo daquele dia LOCAL.
 *
 * Duas passadas porque uma só erra na fronteira de horário de verão: o
 * deslocamento medido em `T00:00Z` pode não ser o do instante que sobra depois
 * de subtraído. Recusar fuso inválido já aconteceu antes (`fusoValido`): a
 * entrada é do navegador e vai para `Intl`, que levanta exceção com nome torto.
 */
function inicioDoDia(data: string, tz: string): Date {
  const pretendido = Date.parse(`${data}T00:00:00Z`);
  const primeira = deslocamentoDe(pretendido, tz);
  const tentativa = pretendido - primeira;
  const segunda = deslocamentoDe(tentativa, tz);
  return new Date(segunda === primeira ? tentativa : pretendido - segunda);
}

function deslocamentoDe(instanteUtcMs: number, tz: string): number {
  const p = partesLocais(new Date(instanteUtcMs), tz);
  const localComoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return localComoUtc - instanteUtcMs;
}
