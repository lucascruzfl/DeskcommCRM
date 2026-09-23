import { declararTools } from "./tipos";

export const TOOLS_SKILL_VERSIONS = declararTools([
  {
    name: "crm_list_ai_skill_versions",
    category: "read",
    rotulo: "Ver versões de uma skill",
    explicacao: "Mostra o histórico de versões da skill instalada nesta empresa e identifica a versão ativa, sem alterar o agente.",
    oQueToca: "Skills do agente",
    risco: "seguro",
    pacotes: ["evoluir"],
  },
  {
    name: "crm_restore_ai_skill_version",
    category: "write",
    rotulo: "Restaurar versão de uma skill",
    explicacao: "Volta o ponteiro da skill para uma versão já existente desta empresa; o agente usa o texto restaurado no próximo turno.",
    oQueToca: "Skills do agente",
    risco: "critico",
    pacotes: ["evoluir"],
    apenasHumano: true,
  },
]);
