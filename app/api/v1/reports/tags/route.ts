/**
 * GET /api/v1/reports/tags — o RELATÓRIO POR ETIQUETA (fatia F1 da #1833):
 * qual assunto ocupou a operação neste período, e quanto tempo ele esperou.
 *
 * ## Uma pergunta, três números — e nada além (invariante 5)
 *
 * `lib/reports/atividades.ts` já escreveu a régua na cabeça do próprio relatório:
 * *"um relatório que mostra tudo não responde nada… número que não muda uma
 * decisão é ruído"*. Por etiqueta saem só VOLUME (`conversas`), DESFECHO
 * (`abertas`/`resolvidas`) e ESPERA (`espera_media_segundos`), mais `fatia` —
 * volume já com denominador declarado, para a barra não inventar o seu.
 * Canal, atendente, dia e valor ficam DE FORA: são outras perguntas, com outras
 * rotas (`/metrics/attendants`, `/reports/activities`, `/metrics/lost`).
 *
 * ## Por que a fonte é `conversations.tags`, e não `crm_lead_activities`
 *
 * O relatório de atividades responde *"o que aconteceu, e quem fez — gente ou
 * máquina"* a partir de `crm_lead_activities`, que **não tem coluna de conversa**
 * (a issue mediu: só `actor_kind`, `actor_agent_id`, `evidence` e `reason` foram
 * acrescentados). Grudar as duas perguntas numa tabela só inventaria um join que
 * não existe. O relatório por etiqueta lê `conversations` — `tags text[]` com
 * índice GIN (migration 0033), a mesma coluna que o operador preenche o dia
 * inteiro e que até aqui não virava número nenhum.
 *
 * ## A dimensão vem do que EXISTE, nunca do que foi sugerido
 *
 * A lista de linhas sai de `fn_tags_de_conversa_em_uso(p_org)` (migration 0244,
 * SECURITY INVOKER): é o que `git grep` do filtro já usa. A lista canônica
 * (`organizations.settings.canonical_conversation_tags`) é semente de seletor, e
 * a armadilha 1 da proposta é literalmente o relatório que devolve zero para
 * etiqueta que ninguém usa enquanto a etiqueta visível na tela não aparece.
 * Etiqueta em uso SEM conversa no período continua na lista, com `0` — sumir da
 * lista seria o mesmo defeito com outra roupa.
 *
 * ## A espera: a coluna da Fila, e o que ela mede de fato
 *
 * `espera_media_segundos` parte de `awaiting_since`, a coluna que ordena a Fila
 * (#990, migration 0267). Ela tem DOIS sentidos, e a média herda os dois:
 * - com a bola na equipe, é a mensagem do cliente mais antiga sem resposta, e a
 *   espera corre até `agora` — só aqui a régua coincide com o `avg_wait_seconds`
 *   do painel, que olha quem está na fila;
 * - depois de uma resposta, a coluna vira `last_inbound_at`
 *   (`fn_mark_conversation_message` e `messages/_handler.ts`), e a espera mede da
 *   ÚLTIMA mensagem do cliente até a nossa última resposta — não da primeira.
 * Conversa ENCERRADA com mensagem do cliente sem resposta termina a espera em
 * `service_closed_at`, nunca em `agora`: encerrar não mexe em `awaiting_since`, e
 * contar até `agora` faria o relatório de um mês passado crescer a cada recarga.
 * Sem `awaiting_since` (ou encerrada sem carimbo de encerramento) a conversa não
 * entra na média: `null` é "não medido", e não `0` (a doutrina do
 * `/metrics/atrito` proíbe zero onde o certo é —).
 *
 * **Isto NÃO é `first_human_out − first_in`**, a "1ª resposta" de
 * `fn_attendant_metrics`. Essa exige ler `messages` e paginar a tabela inteira do
 * período — outra fatia, com outro custo, e declarada aqui para não virar número
 * que a tela lê com um nome que não é o seu.
 *
 * ## Escopo: a própria RLS, e por isso o client é o da SESSÃO
 *
 * Client de sessão + `.eq("organization_id", …)` explícito em toda leitura: a
 * policy de `conversations` faz o recorte (agente em modo `own` vê só o próprio),
 * e a doutrina manda o inquilino dito em voz alta em vez de terceirizado.
 * Trocar pelo admin "porque é só leitura" derrubaria o recorte sem erro nenhum na
 * tela. Read-only ⇒ sem audit: a doutrina cobre POST/PATCH/DELETE.
 *
 * ## Sem migração ⇒ a conta é aqui, e a paginação também
 *
 * F1 não cria função no banco, então a agregação roda na aplicação — e é por
 * isso que a leitura paginar: o `max_rows = 1000` (`supabase/config.toml`) corta
 * a resposta SEM avisar, e um total somado sobre uma página viria com cara de
 * certo (a mesma medição que o `/reports/financeiro` registrou: R$ 141.436 em
 * vez de R$ 641.103,60). Aqui o `count` exato diz o tamanho, as páginas andam
 * com `ORDER BY` (sem ele o lote é arbitrário e muda com o plano) e o que não
 * coube chega à tela como `truncado: true`, nunca como número exato.
 *
 * O corte: `sem_dados` com `motivo`, e não uma tabela de zeros — etiqueta com
 * zero AINDA aparece quando o período tem dado, mas período sem nenhuma conversa
 * com etiqueta não devolve linhas vazias fingindo que é relatório.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { getTagsReportHandler } from "@/lib/reports/tags";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;
  const url = new URL(req.url);
  try {
    const result = await getTagsReportHandler(
      await createClient(),
      authz.org.orgId,
      {
        de: url.searchParams.get("de") ?? undefined,
        ate: url.searchParams.get("ate") ?? undefined,
        tz: url.searchParams.get("tz") ?? undefined,
        tags: url.searchParams.getAll("tags").join(","),
      },
      requestId,
    );
    return ok(result, { requestId });
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message, error.status, {
        requestId,
        details: error.details?.issues ?? error.details,
      });
    }
    return fail("internal_error", "Não consegui consultar o relatório por etiqueta.", 500, {
      requestId,
    });
  }
}
