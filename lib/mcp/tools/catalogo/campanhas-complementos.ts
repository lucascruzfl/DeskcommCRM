import { declararTools } from "./tipos";

export const TOOLS_CAMPANHAS_COMPLEMENTOS = declararTools([
  { name: "crm_list_campaign_recipients", category: "read", rotulo: "Ver destinatários da campanha", explicacao: "Lista estados dos destinatários sem exibir seus telefones ou conteúdo da mensagem.", oQueToca: "Destinatários da campanha", risco: "seguro", pacotes: ["organizar"] },
  { name: "crm_list_campaign_templates", category: "read", rotulo: "Ver textos de campanha", explicacao: "Lista os textos salvos para reutilização nas campanhas desta organização.", oQueToca: "Textos de campanha", risco: "seguro", pacotes: ["organizar"] },
  { name: "crm_create_campaign_template", category: "write", rotulo: "Salvar texto de campanha", explicacao: "Salva um novo texto sem alterar o conteúdo de campanhas já preparadas.", oQueToca: "Textos de campanha", risco: "atencao", pacotes: ["organizar"] },
  { name: "crm_update_campaign_template", category: "write", rotulo: "Editar texto de campanha", explicacao: "Altera um texto salvo sem alterar mensagens já preparadas para envio.", oQueToca: "Textos de campanha", risco: "atencao", pacotes: ["organizar"] },
  { name: "crm_delete_campaign_template", category: "write", rotulo: "Excluir texto de campanha", explicacao: "Remove um texto salvo e preserva as campanhas que já o usaram.", oQueToca: "Textos de campanha", risco: "critico", pacotes: ["organizar"] },
  { name: "crm_list_campaign_suppressions", category: "read", rotulo: "Ver exclusões de campanha", explicacao: "Lista as exclusões operacionais exibindo só o final de cada telefone.", oQueToca: "Exclusões de campanha", risco: "seguro", pacotes: ["organizar"] },
  { name: "crm_add_campaign_suppression", category: "write", rotulo: "Excluir telefone de campanhas", explicacao: "Guarda um hash do telefone para impedir novos envios de campanhas a ele.", oQueToca: "Exclusões de campanha", risco: "atencao", pacotes: ["organizar"] },
  { name: "crm_remove_campaign_suppression", category: "write", rotulo: "Remover exclusão de campanha", explicacao: "Remove uma exclusão operacional, sem desfazer qualquer opt-out do titular.", oQueToca: "Exclusões de campanha", risco: "critico", pacotes: ["organizar"] },
  { name: "crm_get_campaign_settings", category: "read", rotulo: "Ver padrões de campanha", explicacao: "Consulta os padrões de ritmo e janela de atribuição usados nas campanhas.", oQueToca: "Padrões de campanha", risco: "seguro", pacotes: ["organizar"] },
  { name: "crm_update_campaign_settings", category: "write", rotulo: "Alterar padrões de campanha", explicacao: "Atualiza ritmo e atribuição sem apagar outras configurações da organização.", oQueToca: "Padrões de campanha", risco: "atencao", pacotes: ["organizar"] },
]);
