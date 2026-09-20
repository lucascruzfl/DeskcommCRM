import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/tasks — as tarefas da organização, em ordem de prazo.
 * POST /api/v1/tasks — cria uma tarefa.
 *
 * Extraído do PR #418 (@clinicacentrodosorrisosc-code). Duas coisas do original
 * NÃO vieram, e as duas por motivo escrito:
 *
 *  1. **A lista de "agendamentos" derivada de `custom_fields`.** O GET original
 *     varria `crm_leads` procurando `agendamento_data`, `agendamento_hora`,
 *     `procedimento` e `agendamento_status` e sintetizava itens com título
 *     `🗓️ Fulano (Limpeza)`. Para a clínica dele isso era a agenda inteira; num
 *     produto que já tem `calendar_appointments` (migration 0177) seria uma
 *     SEGUNDA verdade sobre o mesmo compromisso, alimentada por um jsonb sem
 *     schema — e escrita em vocabulário de um nicho só.
 *
 *  2. **O fallback para `custom_fields.tasks` quando a tabela não existe.** O
 *     original capturava `42P01`/`PGRST205` e passava a gravar as tarefas dentro
 *     do lead. Isso existia porque lá a tabela vivia só no `baseline.sql`, sem
 *     migration — quem aplicasse `migrations/` não a teria. Aqui a 0210 fecha
 *     essa lacuna, e o fallback vira o pior tipo de rede: ele transforma "o
 *     banco desta instalação está desatualizado" em sucesso silencioso, com o
 *     dado indo para um lugar que nenhuma lista, índice ou policy alcança.
 *     Falhar aberto na INFORMAÇÃO é o certo aqui: 500 com a mensagem do banco.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { ApiError } from "@/lib/api/types";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { PRIORIDADES_DA_TAREFA, SITUACOES_DA_TAREFA } from "@/lib/tarefas/tipos";
import { criarTarefa, listarTarefas } from "@/lib/tarefas/operations";

export const dynamic = "force-dynamic";

const criacaoSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  due_date: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.enum(PRIORIDADES_DA_TAREFA).default("medium"),
  status: z.enum(SITUACOES_DA_TAREFA).default("pending"),
  lead_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
});

const listaSchema = z.object({
  status: z.enum(SITUACOES_DA_TAREFA).optional(),
  priority: z.enum(PRIORIDADES_DA_TAREFA).optional(),
  lead_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  due_from: z.string().datetime({ offset: true }).optional(),
  due_to: z.string().datetime({ offset: true }).optional(),
  /** "abertas" = o que ainda pede ação. É o default da tela. */
  aberto: z.enum(["true", "false"]).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("viewer", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = listaSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return fail("validation_failed", t("Parâmetros inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const filtros = parsed.data;

  const supabase = await createClient();
  // ⚠️ `organization_id` à mão mesmo com RLS ligada: é a regra do CLAUDE.md, e
  // ela não é redundante — o dia em que esta rota trocar para o admin client
  // (que bypassa RLS) o filtro já está aqui.
  try {
    const result = await listarTarefas({ supabase, organizationId: authz.org.orgId,
      actor: { type: "user", id: authz.user.id }, requestId }, {
      ...filtros, open_only: filtros.aberto === "true", limit: 500, offset: 0,
    });
    return ok({ tasks: result.tasks }, { requestId });
  } catch {
    return fail("internal_error", t("Erro ao listar as tarefas."), 500, { requestId });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  // `agent` e não `manager`: criar tarefa é o gesto de quem ATENDE, todo dia.
  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = criacaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  try {
    const tarefa = await criarTarefa({ supabase, organizationId: authz.org.orgId,
      actor: { type: "user", id: authz.user.id }, requestId }, parsed.data);
    return ok({ task: tarefa }, { requestId, status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return fail(error.code, error.message, error.status, { requestId });
    return fail("internal_error", t("Erro ao salvar a tarefa."), 500, { requestId });
  }
}
