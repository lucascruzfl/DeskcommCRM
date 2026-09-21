import { declararTools, type McpToolCatalogEntry } from "./tipos";

type Base = Pick<McpToolCatalogEntry, "name" | "category" | "rotulo" | "oQueToca">;
function entradas(itens: readonly Base[]): ReadonlyArray<McpToolCatalogEntry> {
  return declararTools(
    itens.map((item) => ({
      ...item,
      explicacao:
        item.category === "read"
          ? `Mostra ${item.oQueToca.toLowerCase()} com segurança, sem revelar credenciais nem alterar a operação.`
          : `Altera ${item.oQueToca.toLowerCase()} com isolamento da empresa, validação e registro da mudança.`,
      risco: item.category === "read" ? "seguro" : "atencao",
      pacotes: item.oQueToca.includes("Conhecimento")
        ? ["evoluir"]
        : item.oQueToca.includes("Produto") || item.oQueToca.includes("Pedido")
          ? ["vender"]
          : ["organizar"],
      apenasHumano: true,
    })),
  );
}

export const TOOLS_PARTE6 = entradas([
  {
    name: "crm_get_knowledge_source",
    category: "read",
    rotulo: "Consultar uma fonte de conhecimento",
    oQueToca: "Conhecimento da empresa",
  },
  {
    name: "crm_create_knowledge_source",
    category: "write",
    rotulo: "Criar uma fonte de conhecimento",
    oQueToca: "Conhecimento da empresa",
  },
  {
    name: "crm_update_knowledge_source",
    category: "write",
    rotulo: "Editar uma fonte de conhecimento",
    oQueToca: "Conhecimento da empresa",
  },
  {
    name: "crm_replace_knowledge_faq",
    category: "write",
    rotulo: "Substituir perguntas frequentes",
    oQueToca: "Conhecimento da empresa",
  },
  {
    name: "crm_reindex_knowledge_source",
    category: "write",
    rotulo: "Reindexar uma fonte de conhecimento",
    oQueToca: "Conhecimento da empresa",
  },
  {
    name: "crm_archive_knowledge_source",
    category: "write",
    rotulo: "Arquivar uma fonte de conhecimento",
    oQueToca: "Conhecimento da empresa",
  },
  {
    name: "crm_get_knowledge_upload_instructions",
    category: "read",
    rotulo: "Consultar como enviar um documento",
    oQueToca: "Conhecimento da empresa",
  },
  {
    name: "crm_get_message_template",
    category: "read",
    rotulo: "Consultar uma resposta pronta",
    oQueToca: "Respostas prontas",
  },
  {
    name: "crm_create_message_template",
    category: "write",
    rotulo: "Criar uma resposta pronta",
    oQueToca: "Respostas prontas",
  },
  {
    name: "crm_update_message_template",
    category: "write",
    rotulo: "Editar uma resposta pronta",
    oQueToca: "Respostas prontas",
  },
  {
    name: "crm_duplicate_message_template",
    category: "write",
    rotulo: "Duplicar uma resposta pronta",
    oQueToca: "Respostas prontas",
  },
  {
    name: "crm_delete_message_template",
    category: "write",
    rotulo: "Excluir uma resposta pronta",
    oQueToca: "Respostas prontas",
  },
  {
    name: "crm_list_external_message_templates",
    category: "read",
    rotulo: "Listar modelos externos de mensagem",
    oQueToca: "Respostas prontas",
  },
  {
    name: "crm_list_products",
    category: "read",
    rotulo: "Listar produtos",
    oQueToca: "Produtos do catálogo",
  },
  {
    name: "crm_get_product",
    category: "read",
    rotulo: "Consultar um produto",
    oQueToca: "Produtos do catálogo",
  },
  {
    name: "crm_create_product",
    category: "write",
    rotulo: "Criar um produto",
    oQueToca: "Produtos do catálogo",
  },
  {
    name: "crm_update_product",
    category: "write",
    rotulo: "Editar um produto",
    oQueToca: "Produtos do catálogo",
  },
  {
    name: "crm_delete_product",
    category: "write",
    rotulo: "Excluir um produto",
    oQueToca: "Produtos do catálogo",
  },
  {
    name: "crm_list_orders",
    category: "read",
    rotulo: "Listar pedidos",
    oQueToca: "Pedidos sincronizados",
  },
  {
    name: "crm_get_order",
    category: "read",
    rotulo: "Consultar um pedido",
    oQueToca: "Pedidos sincronizados",
  },
  {
    name: "crm_get_webhook_source",
    category: "read",
    rotulo: "Consultar uma entrada automática",
    oQueToca: "Entradas automáticas",
  },
  {
    name: "crm_update_webhook_source",
    category: "write",
    rotulo: "Editar uma entrada automática",
    oQueToca: "Entradas automáticas",
  },
  {
    name: "crm_delete_webhook_source",
    category: "write",
    rotulo: "Excluir uma entrada automática",
    oQueToca: "Entradas automáticas",
  },
  {
    name: "crm_discover_integrations",
    category: "read",
    rotulo: "Descobrir integrações disponíveis",
    oQueToca: "Integrações da empresa",
  },
  {
    name: "crm_prepare_integration_action",
    category: "read",
    rotulo: "Preparar uma ação de integração",
    oQueToca: "Integrações da empresa",
  },
  {
    name: "crm_get_channel_admin",
    category: "read",
    rotulo: "Consultar a saúde de um canal",
    oQueToca: "Canais de atendimento",
  },
  {
    name: "crm_update_channel_ai_access",
    category: "write",
    rotulo: "Alterar o acesso da IA no canal",
    oQueToca: "Canais de atendimento",
  },
  {
    name: "crm_prepare_channel_action",
    category: "read",
    rotulo: "Preparar uma ação no canal",
    oQueToca: "Canais de atendimento",
  },
  {
    name: "crm_get_team_member",
    category: "read",
    rotulo: "Consultar um membro da equipe",
    oQueToca: "Equipe da empresa",
  },
  {
    name: "crm_list_team_invites",
    category: "read",
    rotulo: "Listar convites da equipe",
    oQueToca: "Equipe da empresa",
  },
  {
    name: "crm_invite_team_member",
    category: "write",
    rotulo: "Convidar um membro da equipe",
    oQueToca: "Equipe da empresa",
  },
  {
    name: "crm_resend_team_invite",
    category: "write",
    rotulo: "Reenviar um convite da equipe",
    oQueToca: "Equipe da empresa",
  },
  {
    name: "crm_revoke_team_invite",
    category: "write",
    rotulo: "Revogar um convite da equipe",
    oQueToca: "Equipe da empresa",
  },
  {
    name: "crm_update_team_member_role",
    category: "write",
    rotulo: "Alterar o papel de um membro",
    oQueToca: "Equipe da empresa",
  },
  {
    name: "crm_update_team_member_interface",
    category: "write",
    rotulo: "Alterar as áreas de um membro",
    oQueToca: "Equipe da empresa",
  },
  {
    name: "crm_revoke_team_member",
    category: "write",
    rotulo: "Revogar um membro da equipe",
    oQueToca: "Equipe da empresa",
  },
  {
    name: "crm_reactivate_team_member",
    category: "write",
    rotulo: "Reativar um membro da equipe",
    oQueToca: "Equipe da empresa",
  },
]);
