import { declararTools } from "./tipos";

export const TOOLS_MANAGED_CLIENTS = declararTools([
  {
    name: "crm_list_managed_client_presets",
    category: "read",
    rotulo: "Ver perfis de clientes gerenciados",
    explicacao: "Mostra os tipos de negócio preparados, suas áreas e se a criação de uma nova organização já está liberada.",
    oQueToca: "Planejamento de novos clientes",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_preflight_managed_client",
    category: "read",
    rotulo: "Conferir plano de cliente gerenciado",
    explicacao: "Mostra a clínica proposta, o convidado, a divisão de áreas e os bloqueios de segurança antes de qualquer criação.",
    oQueToca: "Planejamento de novos clientes",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
]);
