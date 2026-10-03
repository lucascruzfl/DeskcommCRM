import { ApiError } from "@/lib/api/types";
import { queryKnowledgeHandler } from "@/lib/ai/knowledge/consulta-administrativa";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";

import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * "Perguntar ao acervo" — a superfície do OPERADOR sobre a MESMA busca que a IA faz.
 *
 * Não reimplementa retrieval: chama `buscarConhecimento`, que o próprio docblock
 * define como "operação única, compartilhada". Duas implementações divergiriam em
 * limiar e em top-K, e o sistema passaria a responder diferente para a IA e para o
 * humano sobre o MESMO acervo — que é exatamente o defeito que a casa já corrigiu
 * uma vez (limiares 0,40 / 0,72 / 0,72 unificados na migração 0097).
 *
 * `organization_id` sai da sessão autenticada (`requireRole`), NUNCA do corpo —
 * mesma regra documentada em `lib/ai/knowledge/busca.ts`.
 *
 * Devolve `motivo` junto de um `trechos` possivelmente vazio, porque "a base não
 * tem essa informação" e "a base tem algo perto, mas não o bastante" são situações
 * que pedem ações opostas (reformular × perguntar para humano) e não podem chegar
 * iguais a quem pergunta. Sem isso a tela promete "sem resultado" para uma busca
 * que quase acertou.
 */

const QUANTIDADE_PADRAO = 6;
const QUANTIDADE_MAXIMA = 10;

/**
 * Cada pergunta gasta um embedding pago na chave do self-hoster. Mesmo padrão
 * da conversa do caso (`ai/cases/[id]/chat`): teto por PESSOA e por
 * ORGANIZAÇÃO — "12 por pessoa" com 20 pessoas seria 240 chamadas por minuto.
 */
const TETO_POR_USUARIO = 12;
const TETO_POR_ORGANIZACAO = 60;
const JANELA_SEGUNDOS = 60;

const corpoDaBusca = z.object({
  // `max` antes de gastar embedding: sem ele, um texto de megabytes vira
  // tokens pagos numa única chamada.
  pergunta: z.string().trim().min(2).max(1000),
  agentId: z.string().uuid().nullish(),
  // Tolerante de propósito: fora da faixa é aparado, não recusado (ver `numero`).
  quantidade: z.unknown().optional(),
});

/** Converte o corpo sem confiar em tipo algum — qualquer coisa fora vira o default. */
function numero(v: unknown, padrao: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  // A rota MUTA: a F2 da #1869 grava a pergunta em `knowledge_searches`.
  // Sem esta guarda, o modo support_readonly seria ignorado por um handler que
  // escreve — quem está acompanhando em leitura veria linhas novas nascendo
  // métrica da própria instalação. `requireSupportWrite` (retorno não-nulo é a
  // recusa) cuida do MODO DE ACOMPANHAMENTO; o `requireRole` abaixo cuida do
  // PAPEL. Um não substitui o outro.
  const support = await requireSupportWrite();
  if (support) return support;

  // Papel mínimo do inbox: um atendente lê conversa e lê acervo.
  const authz = await requireRole("agent", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    return fail("unprocessable", t("Corpo inválido."), 422, { requestId });
  }
  const parsed = corpoDaBusca.safeParse(bruto);
  if (!parsed.success) {
    return fail("unprocessable", t("Corpo inválido."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const organizationId = authz.org.orgId;
  const porUsuario = await checkRateLimit(
    `acervo-busca:${authz.user.id}`,
    TETO_POR_USUARIO,
    JANELA_SEGUNDOS,
  );
  const porOrganizacao = await checkRateLimit(
    `acervo-busca-org:${organizationId}`,
    TETO_POR_ORGANIZACAO,
    JANELA_SEGUNDOS,
  );
  if (!porUsuario.allowed || !porOrganizacao.allowed) {
    return fail("rate_limited", t("Muitas perguntas seguidas. Tente em um minuto."), 429, {
      requestId,
      headers: {
        "Retry-After": String(JANELA_SEGUNDOS),
        "X-RateLimit-Limit": String(porUsuario.limit),
        "X-RateLimit-Remaining": String(Math.max(0, porUsuario.limit - porUsuario.count)),
      },
    });
  }

  const supabase = await createClient();
  const agentId = parsed.data.agentId ?? null;
  const quantidade = numero(parsed.data.quantidade, QUANTIDADE_PADRAO, 1, QUANTIDADE_MAXIMA);

  try {
    return ok(
      await queryKnowledgeHandler(
        supabase,
        {
          organization_id: organizationId,
          actor: { type: "user", id: authz.user.id },
          requestId,
          idioma: authz.user.idioma,
        },
        { pergunta: parsed.data.pergunta, agentId, quantidade },
      ),
      { requestId },
    );
  } catch (error) {
    if (error instanceof ApiError)
      return fail(error.code, error.message, error.status, { requestId });
    throw error;
  }
}
