/** Executa a máquina de estados real contra o Postgres LOCAL do piloto, sem transporte. */
import { z } from "zod";

import { createPool } from "@/lib/agent-engine/db/pool";
import { openCase, resolveCaseFromHuman } from "@/lib/agent-engine/agent/human-cases";
import { performHumanHandoff, isLeadInHandoff } from "@/lib/agent-engine/agent/human-handoff";
import { montarBriefingDaPassagem } from "@/lib/escalacao/briefing-da-passagem";

async function main() {
  const [rawAction, rawOrg, rawConversation, rawContact, rawAgent, rawCase, rawManager] = process.argv.slice(2);
  const action = z.enum(["open", "handoff", "resolve", "is_silenced"]).parse(rawAction);
  const org = z.uuid().parse(rawOrg);
  const conversation = z.uuid().parse(rawConversation);
  const contact = z.uuid().parse(rawContact);
  const url = process.env.SUPABASE_DB_URL;
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
    throw new Error("managed ISP human fixture requires disposable localhost Postgres");
  }
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const pool = createPool(url);
  try {
  if (action === "open") {
    const agent = z.uuid().parse(rawAgent);
    const opened = await openCase(pool, { tenantId: org, conversationId: conversation, agentId: agent }, {
      title: "Confirmar cobertura do endereço fictício",
      summary: "O bairro tem rede informada; a disponibilidade no endereço segue pendente.",
      blocker: "Uma pessoa precisa confirmar endereço completo e porta disponível.",
      kind: "duvida",
    });
    if (!opened.ok) throw new Error(opened.error.code);
    process.stdout.write(opened.caseId);
  } else if (action === "handoff") {
    const caseId = z.uuid().parse(rawCase);
    const briefing = montarBriefingDaPassagem({
      checkpoint: null,
      motivo: { codigo: "requested_human", texto: "Cliente pediu uma pessoa para acompanhar a cobertura." },
      caso: {
        titulo: "Confirmar cobertura do endereço fictício",
        summary: "Bairro com rede informada; cobertura do endereço ainda não confirmada.",
        blocker: "Equipe verifica endereço completo e porta disponível.",
      },
      declaradoPeloModelo: {
        tentativas: [{ o_que: "consultei o acervo", desfecho: "não confirma o endereço" }],
        cliente_quer: "falar com uma pessoa antes de contratar",
      },
    });
    await performHumanHandoff(pool, { tenantId: org, leadId: contact, conversationId: conversation }, {
      reason: "requested_human", conversationSummary: briefing.body,
      passagem: { origem: "ferramenta_do_modelo", motivoCodigo: "requested_human", briefing, casoId: caseId },
      avisoAoLead: { avisado: false, porque: "piloto_sem_transporte", motivoCodigo: "na_fila_canal_fora" },
      log,
    });
    process.stdout.write("handoff_recorded");
  } else if (action === "resolve") {
    const caseId = z.uuid().parse(rawCase);
    const manager = z.uuid().parse(rawManager);
    const resolved = await resolveCaseFromHuman(
      pool, org, caseId, manager,
      "Conferência humana concluída no piloto: endereço ainda depende da visita técnica; não há data prometida.",
    );
    if (!resolved) throw new Error("case_not_open");
    process.stdout.write("human_decision_recorded");
  } else {
    process.stdout.write(String(await isLeadInHandoff(pool, org, contact)));
  }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
