/**
 * Catalogo agregado de tools MCP.
 *
 * A quantidade e a composição são derivadas deste registry; não mantenha um
 * contador paralelo. `tools/list` filtra esta fonte única pela policy do token.
 */
import type { McpToolDefinition } from "../types";
import { TOOL_CATALOG, VALID_TOOL_IDS } from "./catalog";
import {
  crmSearchContacts,
  crmGetContact,
  crmProposeContactField,
  crmCreateContact,
  crmUpdateContact,
  crmGetContactTimeline,
  crmDeleteContact,
} from "./contacts";
import {
  crmListConversations,
  crmGetConversation,
  crmGetConversationHistory,
} from "./conversations";
import {
  crmListLeads,
  crmGetLead,
  crmCreateLead,
  crmUpdateLead,
  crmMoveLeadStage,
  crmMoveLeadPipeline,
  crmGetLeadTimeline,
} from "./leads";
import {
  crmListPipelines,
  crmGetPipeline,
  crmCreatePipeline,
  crmUpdatePipeline,
  crmArchivePipeline,
  crmUpdatePipelineSchema,
} from "./pipelines";
import { crmSendWhatsappMessage } from "./messages";
import { crmStartConversationAndSend } from "./start-conversation";
import {
  crmAssignConversation,
  crmManageTags,
  crmGetQueueStatus,
} from "./governance";
import {
  crmListAvailableAttendants,
  crmListHumanCases,
  crmGetHumanCase,
  crmAddCaseNote,
  crmCloseHumanCase,
  crmResumeAiAttendance,
} from "./escalacao";
import { crmRequestHumanHandoff } from "./handoff";
import {
  crmSearchKnowledge,
  crmListKnowledgeSources,
  crmListImprovementProposals,
  crmGetOrgMemory,
  crmSaveOrgMemory,
} from "./evolucao";
import { crmListContactOrders, crmSearchProducts } from "./comercio";
import { crmListPrivacyRequests } from "./privacidade";
import {
  crmArchiveStage,
  crmCreateStage,
  crmCreateWebhookSource,
  crmListAutomationRules,
  crmListAutomationRuns,
  crmListMessageTemplates,
  crmListStages,
  crmListTags,
  crmListTeamMembers,
  crmListWebhookSourceEvents,
  crmListWebhookSources,
  crmRenderMessageTemplate,
  crmSetAutomationRuleActive,
  crmSetWebhookSourceActive,
  crmUpdateStage,
} from "./operacao";
import {
  crmBookAppointment,
  crmCancelAppointment,
  crmConfirmAppointment,
  crmFindAndBookAppointment,
  crmFindFreeSlots,
  crmListAppointments,
  crmListEventTypes,
  crmRescheduleAppointment,
  crmSetAppointmentOutcome,
} from "./agendamento";
import {
  crmScheduleFollowup,
  crmEnrollFollowupFlow,
  crmCancelFollowup,
  crmListFollowups,
  crmListAtRiskLeads,
  crmCloseDemand,
  crmProposeReactivation,
} from "./retencao";
import { AI_MCP_TOOLS } from "./ia";
import { CRM_TASK_TOOLS } from "./tarefas";
import { CRM_TAG_TOOLS } from "./tags";
import { crmSetCustomFieldValues } from "./campos-personalizados";

// Cast via `unknown` porque McpToolDefinition<TInput> nao e covariante
// em TInput (handler usa TInput em posicao contravariante). Coletar
// definicoes heterogeneas em array unico exige apagar o input shape no
// nivel do array — o server core ja recebe args como `Record<string,
// unknown>` e cada handler valida no Zod do registerTool.
export const allTools: ReadonlyArray<McpToolDefinition> = [
  ...AI_MCP_TOOLS,
  // read
  crmListEventTypes,
  crmFindFreeSlots,
  crmListAppointments,
  crmSearchContacts,
  crmGetContact,
  crmGetContactTimeline,
  crmProposeContactField,
  crmListConversations,
  crmGetConversation,
  crmGetConversationHistory,
  crmGetQueueStatus,
  crmListLeads,
  crmGetLead,
  crmGetLeadTimeline,
  crmListPipelines,
  crmGetPipeline,
  crmSearchKnowledge,
  crmListKnowledgeSources,
  crmListImprovementProposals,
  crmGetOrgMemory,
  crmSaveOrgMemory,
  crmListContactOrders,
  crmSearchProducts,
  crmListPrivacyRequests,
  // read — organizar a operação (W4)
  crmListStages,
  crmListTags,
  crmListMessageTemplates,
  crmRenderMessageTemplate,
  crmListWebhookSources,
  crmListWebhookSourceEvents,
  crmListAutomationRules,
  crmListAutomationRuns,
  crmListTeamMembers,
  crmListFollowups,
  crmListAtRiskLeads,
  crmListAvailableAttendants,
  crmListHumanCases,
  crmGetHumanCase,
  ...CRM_TASK_TOOLS.filter((tool) => tool.category === "read"),
  ...CRM_TAG_TOOLS.filter((tool) => tool.category === "read"),
  // write
  // A que consulta E marca numa chamada só vem primeiro: quando o cliente já deu
  // dia e hora, é o caminho curto, e é o que evita o turno morrer no meio (#831).
  crmFindAndBookAppointment,
  crmBookAppointment,
  crmRescheduleAppointment,
  crmCancelAppointment,
  crmConfirmAppointment,
  crmSetAppointmentOutcome,
  crmCreateLead,
  crmUpdateLead,
  crmMoveLeadStage,
  crmMoveLeadPipeline,
  crmSendWhatsappMessage,
  crmStartConversationAndSend,
  crmAssignConversation,
  crmManageTags,
  crmCreateContact,
  crmUpdateContact,
  crmDeleteContact,
  crmCreatePipeline,
  crmUpdatePipeline,
  crmArchivePipeline,
  crmUpdatePipelineSchema,
  crmSetCustomFieldValues,
  ...CRM_TASK_TOOLS.filter((tool) => tool.category === "write"),
  ...CRM_TAG_TOOLS.filter((tool) => tool.category === "write"),
  // write — organizar a operação (W4)
  crmCreateStage,
  crmUpdateStage,
  crmArchiveStage,
  crmCreateWebhookSource,
  crmSetWebhookSourceActive,
  crmSetAutomationRuleActive,
  crmScheduleFollowup,
  crmEnrollFollowupFlow,
  crmCancelFollowup,
  crmCloseDemand,
  crmProposeReactivation,
  crmAddCaseNote,
  crmCloseHumanCase,
  crmResumeAiAttendance,
  // handoff (special)
  crmRequestHumanHandoff,
] as unknown as ReadonlyArray<McpToolDefinition>;

// Sanity: catalogo estatico (importavel por client) deve cobrir 1:1 os handlers.
// Erro em dev se alguem adicionar handler sem atualizar catalog.ts.
if (process.env.NODE_ENV !== "production") {
  const handlerNames = new Set(allTools.map((t) => t.name));
  const catalogNames = new Set(TOOL_CATALOG.map((t) => t.name));
  for (const n of handlerNames) {
    if (!catalogNames.has(n)) {
      throw new Error(`mcp/tools: handler "${n}" ausente em lib/mcp/tools/catalog.ts`);
    }
  }
  for (const n of catalogNames) {
    if (!handlerNames.has(n)) {
      throw new Error(`mcp/tools: catalog "${n}" sem handler correspondente`);
    }
  }
}

export { VALID_TOOL_IDS };

export function getToolByName(name: string): McpToolDefinition | undefined {
  return allTools.find((t) => t.name === name);
}
