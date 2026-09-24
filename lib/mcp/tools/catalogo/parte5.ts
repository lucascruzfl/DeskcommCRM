import { declararTools, type McpToolCatalogEntry } from "./tipos";

type Base = Pick<McpToolCatalogEntry, "name" | "category" | "rotulo" | "oQueToca">;
function entradas(itens: readonly Base[]): ReadonlyArray<McpToolCatalogEntry> {
  return declararTools(
    itens.map((item) => ({
      ...item,
      explicacao:
        item.category === "read"
          ? `Mostra ${item.oQueToca.toLowerCase()} com os detalhes necessários para decidir o próximo passo sem alterar nada.`
          : `Altera ${item.oQueToca.toLowerCase()} com validação, isolamento da empresa e registro visível do que aconteceu.`,
      risco: item.category === "read" ? "seguro" : "atencao",
      pacotes: item.oQueToca.includes("Agenda")
        ? ["atender"]
        : item.oQueToca.includes("Retorno")
          ? ["reter"]
          : ["organizar"],
      apenasHumano: true,
    })),
  );
}

export const TOOLS_PARTE5 = entradas([
  {
    name: "crm_get_event_type",
    category: "read",
    rotulo: "Consultar um tipo de atendimento",
    oQueToca: "Agenda e tipos de atendimento",
  },
  {
    name: "crm_create_event_type",
    category: "write",
    rotulo: "Criar um tipo de atendimento",
    oQueToca: "Agenda e tipos de atendimento",
  },
  {
    name: "crm_update_event_type",
    category: "write",
    rotulo: "Editar um tipo de atendimento",
    oQueToca: "Agenda e tipos de atendimento",
  },
  {
    name: "crm_set_event_type_active",
    category: "write",
    rotulo: "Mudar uso de um tipo de atendimento",
    oQueToca: "Agenda e tipos de atendimento",
  },
  {
    name: "crm_list_availability",
    category: "read",
    rotulo: "Ver a disponibilidade da equipe",
    oQueToca: "Agenda e disponibilidade da equipe",
  },
  {
    name: "crm_update_availability",
    category: "write",
    rotulo: "Alterar a disponibilidade da equipe",
    oQueToca: "Agenda e disponibilidade da equipe",
  },
  {
    name: "crm_list_availability_exceptions",
    category: "read",
    rotulo: "Ver bloqueios e aberturas especiais",
    oQueToca: "Agenda e exceções de horário",
  },
  {
    name: "crm_create_availability_exception",
    category: "write",
    rotulo: "Criar um horário especial",
    oQueToca: "Agenda e exceções de horário",
  },
  {
    name: "crm_delete_availability_exception",
    category: "write",
    rotulo: "Remover um horário especial",
    oQueToca: "Agenda e exceções de horário",
  },
  {
    name: "crm_list_followup_flows",
    category: "read",
    rotulo: "Ver planos de acompanhamento",
    oQueToca: "Retornos e planos de acompanhamento",
  },
  {
    name: "crm_get_followup_flow",
    category: "read",
    rotulo: "Consultar um plano de acompanhamento",
    oQueToca: "Retornos e planos de acompanhamento",
  },
  {
    name: "crm_create_followup_flow",
    category: "write",
    rotulo: "Criar um plano de acompanhamento",
    oQueToca: "Retornos e planos de acompanhamento",
  },
  {
    name: "crm_duplicate_followup_flow",
    category: "write",
    rotulo: "Duplicar fluxo de follow-up",
    oQueToca: "Fluxos de follow-up",
  },
  {
    name: "crm_update_followup_flow",
    category: "write",
    rotulo: "Editar um plano de acompanhamento",
    oQueToca: "Retornos e planos de acompanhamento",
  },
  {
    name: "crm_preflight_followup_flow",
    category: "read",
    rotulo: "Validar um plano de acompanhamento",
    oQueToca: "Retornos e planos de acompanhamento",
  },
  {
    name: "crm_publish_followup_flow",
    category: "write",
    rotulo: "Publicar um plano de acompanhamento",
    oQueToca: "Retornos e planos de acompanhamento",
  },
  {
    name: "crm_set_followup_flow_active",
    category: "write",
    rotulo: "Pausar ou retomar um plano",
    oQueToca: "Retornos e planos de acompanhamento",
  },
  {
    name: "crm_delete_followup_flow",
    category: "write",
    rotulo: "Excluir um plano de acompanhamento",
    oQueToca: "Retornos e planos de acompanhamento",
  },
  {
    name: "crm_list_followup_enrollments",
    category: "read",
    rotulo: "Ver acompanhamentos em andamento",
    oQueToca: "Retornos e acompanhamentos ativos",
  },
  {
    name: "crm_get_followup_enrollment",
    category: "read",
    rotulo: "Consultar um acompanhamento ativo",
    oQueToca: "Retornos e acompanhamentos ativos",
  },
  {
    name: "crm_control_followup_enrollment",
    category: "write",
    rotulo: "Intervir em um acompanhamento",
    oQueToca: "Retornos e acompanhamentos ativos",
  },
  {
    name: "crm_discover_automation_triggers",
    category: "read",
    rotulo: "Descobrir acontecimentos disponíveis",
    oQueToca: "Regras automáticas",
  },
  {
    name: "crm_discover_automation_actions",
    category: "read",
    rotulo: "Descobrir ações disponíveis",
    oQueToca: "Regras automáticas",
  },
  {
    name: "crm_get_automation_rule",
    category: "read",
    rotulo: "Consultar uma regra automática",
    oQueToca: "Regras automáticas",
  },
  {
    name: "crm_preflight_automation_rule",
    category: "read",
    rotulo: "Validar uma regra automática",
    oQueToca: "Regras automáticas",
  },
  {
    name: "crm_create_automation_rule",
    category: "write",
    rotulo: "Criar uma regra automática",
    oQueToca: "Regras automáticas",
  },
  {
    name: "crm_update_automation_rule",
    category: "write",
    rotulo: "Editar uma regra automática",
    oQueToca: "Regras automáticas",
  },
  {
    name: "crm_duplicate_automation_rule",
    category: "write",
    rotulo: "Duplicar uma regra automática",
    oQueToca: "Regras automáticas",
  },
  {
    name: "crm_delete_automation_rule",
    category: "write",
    rotulo: "Excluir uma regra automática",
    oQueToca: "Regras automáticas",
  },
  {
    name: "crm_simulate_automation_rule",
    category: "read",
    rotulo: "Simular uma regra automática",
    oQueToca: "Regras automáticas",
  },
  {
    name: "crm_get_automation_run",
    category: "read",
    rotulo: "Consultar uma execução automática",
    oQueToca: "Regras automáticas e histórico",
  },
  {
    name: "crm_get_routing_config",
    category: "read",
    rotulo: "Consultar a distribuição de atendimento",
    oQueToca: "Distribuição de atendimento",
  },
  {
    name: "crm_update_routing_config",
    category: "write",
    rotulo: "Alterar a distribuição de atendimento",
    oQueToca: "Distribuição de atendimento",
  },
  {
    name: "crm_list_routing_destinations",
    category: "read",
    rotulo: "Ver destinos de atendimento",
    oQueToca: "Distribuição de atendimento",
  },
  {
    name: "crm_update_channel_routing",
    category: "write",
    rotulo: "Definir responsáveis por canal",
    oQueToca: "Distribuição de atendimento",
  },
  {
    name: "crm_simulate_routing",
    category: "read",
    rotulo: "Simular uma distribuição de atendimento",
    oQueToca: "Distribuição de atendimento",
  },
] as const);
