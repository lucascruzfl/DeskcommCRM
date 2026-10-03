import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET/PATCH /api/v1/ai/jev — o cartão "Jev — decisões rápidas".
 *
 * GET responde, para a organização ativa, as perguntas que o cartão faz na
 * ordem em que as faz: há chave e ela passou no teste? o Jev está ligado, e
 * observando ou decidindo? a empresa tem a IA de sempre para comparar e servir
 * de reserva? e, ligado, o que ele fez na semana e quanto concordou com a IA de
 * sempre.
 *
 * GET também responde, por tarefa (`por_tarefa`, de `TAREFAS_DO_JEV`), o estado
 * que vale agora, o que ela vira ao ligar o Jev (`ao_ligar`), se ela é nova —
 * começou sozinha e ninguém escolheu ainda — e a concordância dela com a IA de
 * sempre (`observacao`): a do clima, das notas em `messages.metadata`; a das
 * outras, de `jev_observacoes` — e, nas tarefas em cascata, que só são
 * perguntadas onde a regra de hoje disse não, em quantas mensagens o Jev
 * percebeu o pedido que ela não reconheceu (`percebidos`, uma linha de
 * `jev_observacoes` por mensagem), com as conversas mais recentes. E o que a
 * impede de rodar: `sem_camada`, a tarefa acompanha uma camada de segurança que
 * a organização desligou; `sem_roteador`, a do roteador numa empresa sem
 * roteador de intenção ativo; `sem_atendente`, as de pedido numa empresa em que
 * o atendimento automático não roda em número nenhum (ninguém no ar sem pausa,
 * ou o atendimento com um sistema de fora) — o worker só as pergunta onde ele
 * roda; `sem_fluxo`, a do follow-up numa empresa sem follow-up publicado com o
 * passo "Classificar (IA)" e sem inscrição andando numa versão que o tenha.
 *
 * PATCH liga, desliga, troca o modo do clima (`modo`, o nome da onda 1) e o
 * estado de uma tarefa (`tarefa` + `estado` — na em cascata, `decidindo` é o
 * "Avisar a equipe" da tela; na que só observa, `decidindo` é recusado com
 * `jev_tarefa_so_observa`). Ligar manda cada mensagem que o cliente
 * escreve, uma de cada vez e sem o resto da conversa, a um fornecedor nos EUA, então exige chave validada e, na primeira
 * vez, o aceite explícito do administrador (LGPD, D6), que fica gravado com
 * quem e quando. O interruptor mora em `organizations.settings.jev`
 * (`lib/ai/decisao/config.ts`); a organização vem da sessão, nunca do corpo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { credencialEmUsoPeloJev, PROVEDOR_DO_JEV } from "@/lib/ai/decisao/credencial";
import {
  ESTADO_DO_MODO,
  ESTADOS_DA_TAREFA,
  gravarConfigDoJev,
  idDaTarefaSchema,
  lerConfigDoJev,
  type ConfigDoJev,
  type MudancaDaConfig,
} from "@/lib/ai/decisao/config";
import { estadoGravadoDaTarefa, TAREFA_DO_CLIMA, TAREFAS_DO_JEV } from "@/lib/ai/decisao/tarefas";
import { lerEstadoDoJev, JevReadError } from "@/lib/ai/decisao/status";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function configPublica(c: ConfigDoJev) {
  return { ligado: c.ligado, modo: c.modo, aceite: c.aceite };
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_jev" });
  if (!authz.ok) return authz.response;
  try {
    const estado = await lerEstadoDoJev(await createClient(), authz.org.orgId);
    return ok({ ...estado, pode_editar: roleAtLeast(authz.org.role, "admin") }, { requestId });
  } catch (error) {
    if (error instanceof JevReadError)
      return fail("query_failed", "Falha ao consultar o Jev.", 500, { requestId });
    throw error;
  }
}

// `.strict()`: `organization_id` (ou qualquer campo a mais) no corpo é recusado,
// não ignorado — a organização é a da sessão, e ponto.
const corpoDoPatch = z
  .object({
    ligado: z.boolean().optional(),
    /** O estado do clima, no nome da onda 1 — a imagem anterior também o entende. */
    modo: z.enum(["observacao", "decide"]).optional(),
    /** A caixa marcada na tela. Só pesa ao ligar pela primeira vez. */
    aceite_lgpd: z.literal(true).optional(),
    tarefa: idDaTarefaSchema.optional(),
    estado: z.enum(ESTADOS_DA_TAREFA).optional(),
  })
  .strict()
  .refine((c) => (c.tarefa === undefined) === (c.estado === undefined), {
    message: "`tarefa` e `estado` vão juntos",
  })
  .refine((c) => c.modo === undefined || c.tarefa === undefined, {
    message: "informe `modo` ou `tarefa`, não os dois",
  })
  .refine((c) => c.ligado !== undefined || c.modo !== undefined || c.tarefa !== undefined, {
    message: "informe `ligado`, `modo` ou `tarefa`",
  });

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_jev" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;

  const parsed = corpoDoPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_body", t("corpo inválido"), 422, {
      requestId,
      details: parsed.error.issues,
    });
  }
  const corpo = parsed.data;

  // Cliente admin: a RLS de `organizations` só deixa ESCREVER platform admin
  // (ver o PATCH de `app/api/v1/ai/providers/route.ts`). O filtro de tenant é
  // deste arquivo, e `org.orgId` vem do `requireRole`.
  const admin = createAdminClient();
  const { data: orgAtual, error: orgErr } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", org.orgId)
    .maybeSingle();
  if (orgErr) return fail("query_failed", orgErr.message, 500, { requestId });
  const atual = lerConfigDoJev(orgAtual?.settings);

  const mudanca: MudancaDaConfig = {};
  // `modo` é o clima com o nome antigo: os dois pedidos chegam ao mesmo lugar.
  const pedido =
    corpo.tarefa !== undefined && corpo.estado !== undefined
      ? { tarefa: corpo.tarefa, estado: corpo.estado }
      : corpo.modo !== undefined
        ? { tarefa: TAREFA_DO_CLIMA.id, estado: ESTADO_DO_MODO[corpo.modo] }
        : null;
  // A tarefa que só observa não tem o que decidir: aceitar o pedido gravaria um
  // estado que o worker não obedece e que o cartão mostraria como "Só observa".
  const soObserva = pedido
    ? TAREFAS_DO_JEV.find((x) => x.id === pedido.tarefa)?.soObserva
    : undefined;
  if (pedido?.estado === "decidindo" && soObserva !== undefined) {
    return fail("jev_tarefa_so_observa", t(soObserva), 422, { requestId });
  }
  const estadoAnterior = pedido ? estadoGravadoDaTarefa(atual, pedido.tarefa) : undefined;
  if (pedido && pedido.estado !== estadoAnterior)
    mudanca.tarefas = { [pedido.tarefa]: pedido.estado };
  if (corpo.ligado === false && atual.ligado) mudanca.ligado = false;
  if (corpo.ligado === true && !atual.ligado) {
    const { data: creds, error: credsErr } = await admin
      .from("ai_provider_credentials")
      .select("provider, is_active, validated_at, created_at")
      .eq("organization_id", org.orgId)
      .eq("provider", PROVEDOR_DO_JEV)
      .eq("is_active", true);
    if (credsErr) return fail("query_failed", credsErr.message, 500, { requestId });
    if (credencialEmUsoPeloJev(creds ?? []) === null) {
      return fail(
        "jev_exige_chave_validada",
        t("Para ligar o Jev, cole a chave dele em Credenciais e espere o teste da chave passar."),
        422,
        { requestId },
      );
    }
    if (atual.aceite === null) {
      if (corpo.aceite_lgpd !== true) {
        return fail(
          "jev_exige_aceite",
          t(
            "Ligar o Jev manda cada mensagem dos clientes, uma de cada vez e sem o resto da conversa, para a TypeSafe AI, nos Estados Unidos. Para ligar, confirme que você está de acordo.",
          ),
          422,
          { requestId },
        );
      }
      // O texto aceito é o de "cada mensagem, sozinha": o alcance fica gravado
      // para a tarefa que pedir mais nunca valer com ele (`./tarefas`).
      mudanca.aceite = { em: new Date().toISOString(), por: user.id, alcance: "mensagem" };
    }
    mudanca.ligado = true;
  }

  // Pedir o estado que já vale não é mutação: sem escrita e sem auditoria.
  if (Object.keys(mudanca).length === 0) {
    return ok({ config: configPublica(atual), alterado: false }, { requestId });
  }

  const gravado = await gravarConfigDoJev({
    admin,
    orgId: org.orgId,
    actorUserId: user.id,
    mudanca,
  });
  if (!gravado.ok) {
    return fail(
      "save_failed",
      t("nada foi gravado — verifique as permissões da organização"),
      500,
      {
        requestId,
      },
    );
  }

  // Um PATCH é uma mutação, então uma linha — a ação é a mais forte do que mudou.
  void audit({
    action:
      mudanca.ligado === true
        ? "ai.jev.ligado"
        : mudanca.ligado === false
          ? "ai.jev.desligado"
          : corpo.modo !== undefined
            ? "ai.jev.modo_alterado"
            : "ai.jev.tarefa_alterada",
    organizationId: org.orgId,
    actorUserId: user.id,
    resourceType: "organization",
    resourceId: org.orgId,
    requestId,
    metadata: {
      modo: gravado.config.modo,
      ...(gravado.config.modo !== atual.modo ? { modo_anterior: atual.modo } : {}),
      ...(mudanca.tarefas !== undefined && pedido
        ? { tarefa: pedido.tarefa, estado: pedido.estado, estado_anterior: estadoAnterior ?? null }
        : {}),
      aceite_registrado: mudanca.aceite !== undefined,
    },
  });

  return ok({ config: configPublica(gravado.config), alterado: true }, { requestId });
}
