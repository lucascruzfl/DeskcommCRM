import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { SemChaveDeEmbeddingError } from "@/lib/ai/embed";
import { LIMIAR_PADRAO_BUSCA, buscarConhecimento, resolverAcervoDoAgente } from "./busca";
import { traduzir } from "@/lib/i18n/dicionario";
/** Consulta canônica: HTTP por pessoa e MCP administrativo compartilham acervo, limiar e telemetria sem texto. */
export async function queryKnowledgeHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  input: { pergunta: string; agentId?: string | null; quantidade: number },
) {
  const organizationId = ctx.organization_id;
  const requestId = ctx.requestId;
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  const agentId = input.agentId ?? null;
  const quantidade = input.quantidade;
  const pergunta = input.pergunta;
  try {
    let knowledgeSourceIds: string[];
    let limiar = LIMIAR_PADRAO_BUSCA;

    if (agentId) {
      // Escopo do agente: mesmo acervo e MESMO limiar que a IA usaria para responder.
      knowledgeSourceIds = await resolverAcervoDoAgente(supabase, organizationId, agentId);
      const { data: agente } = await supabase
        .from("ai_agents")
        .select("config")
        .eq("id", agentId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      const cfg = agente?.config as { rag_similarity_threshold?: unknown } | null;
      // Mesma faixa que `agent-config.ts` aceita; fora dela o turno usa o padrão.
      const lido = cfg?.rag_similarity_threshold;
      if (typeof lido === "number" && lido >= 0 && lido <= 1) {
        limiar = lido;
      }
    } else {
      // Acervo da organização inteira — a biblioteca é da org; a escolha por
      // assistente é do AGENTE, não do operador que está apenas perguntando.
      const { data: fontes, error } = await supabase
        .from("ai_knowledge_sources")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) {
        throw new ApiError(
          500,
          "internal_error",
          undefined,
          requestId,
          t("Não foi possível ler o acervo."),
        );
      }
      knowledgeSourceIds = (fontes ?? []).map((f) => f.id as string);
    }

    if (knowledgeSourceIds.length === 0) {
      // Acervo vazio NÃO é "sem resultado": é acervo errado ou recém-criado.
      // Dizer "nada encontrado" aqui seria mentir e soaria como defeito.
      return {
        trechos: [],
        melhorSimilaridade: null,
        motivo: t("Este acervo ainda não tem material publicado."),
        acervo: { fontes: 0, limiar },
      };
    }

    const resultado = await buscarConhecimento(supabase, {
      organizationId,
      knowledgeSourceIds,
      pergunta,
      topK: quantidade,
      limiar,
    });

    const vazio = resultado.trechos.length === 0;
    const melhor = resultado.melhorSimilaridade;

    // Três coisas diferentes chegam como "vazio" e pedem respostas opostas.
    const motivo = vazio
      ? melhor === null
        ? t("A base não tem essa informação.")
        : t("Há algo parecido no acervo, mas ainda abaixo do limiar — tente outras palavras.")
      : null;

    // (função logo abaixo, fora do handler — ela nunca pode derrubar a busca)
    void registrarBusca(supabase, {
      organizationId,
      hits: resultado.trechos.length,
      topScore: melhor,
      threshold: limiar,
      fontes: knowledgeSourceIds,
      agentId: agentId ?? null,
      userId: ctx.actor.type === "user" ? ctx.actor.id : null,
      authorKind: ctx.actor.type === "user" ? "human" : "ai",
    });

    return {
      trechos: resultado.trechos,
      melhorSimilaridade: melhor,
      motivo,
      acervo: { fontes: knowledgeSourceIds.length, limiar },
    };
  } catch (e) {
    if (e instanceof SemChaveDeEmbeddingError) {
      // Estado da organização, não acidente: a tela diz o que fazer.
      throw new ApiError(
        409,
        e.code,
        undefined,
        requestId,
        t(
          "Esta organização ainda não tem chave de embedding. Cadastre uma chave OpenAI ou OpenRouter em Credenciais para consultar o acervo.",
        ),
      );
    }
    console.error("[ai-knowledge-busca] falhou");
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      requestId,
      t("Não foi possível consultar o acervo."),
    );
  }
}
/**
 * Grava a pergunta do OPERADOR em `knowledge_searches` — F2 da #1869.
 *
 * ## Por que existe
 *
 * Só o caminho do agente gravava (`search-knowledge.ts:122`). O gráfico de
 * `/app/ai/evolution` conta linhas SEM filtrar (`aggregate.ts:201`), então uma
 * linha humana aparece sozinha — mas só aparece se alguém gravar. `author_kind`
 * (`'human'`) é o que a torna distinguível depois; `agent_id is null` não
 * serviria, porque é `on delete set null` desde a 0181.
 *
 * ## Por que nunca pode derrubar a busca
 *
 * O `catch` do handler devolveria 500 "não foi possível consultar o acervo" para
 * uma busca que CONTEÚM aconteceu e cujos trechos já estão na mão. É o defeito
 * de "prometer primeiro e desmentir depois" que o docblock desta página avisa —
 * só que no sentido inverso: aqui a tela mentiria sobre a própria falha.
 *
 * Mesma decisão do insert do agente (que é engolido de propósito lá, com o
 * `warn` encurtado para não vazar a pergunta no log — esta tabela nunca guarda
 * o texto, decisão da 0086).
 */
async function registrarBusca(
  supabase: SupabaseClient,
  p: {
    organizationId: string;
    hits: number;
    topScore: number | null;
    threshold: number;
    fontes: string[];
    agentId: string | null;
    userId: string | null;
    authorKind: "human" | "ai";
  },
): Promise<void> {
  try {
    const { error } = await supabase.from("knowledge_searches").insert({
      organization_id: p.organizationId,
      hits: p.hits,
      top_score: p.topScore,
      threshold: p.threshold,
      knowledge_source_ids: p.fontes,
      // Guarda o ACERVO consultado, não "quem perguntou": com author_kind='human'
      // a dupla lê "operador perguntou sobre o acervo do assistente X".
      agent_id: p.agentId,
      author_kind: p.authorKind,
      author_user_id: p.userId,
    });
    if (error) console.warn("[ai-knowledge-busca] telemetria não gravada");
  } catch {
    console.warn("[ai-knowledge-busca] telemetria não gravada:");
  }
}
