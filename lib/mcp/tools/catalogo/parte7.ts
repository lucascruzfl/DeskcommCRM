import { declararTools } from "./tipos";

export const TOOLS_PARTE7 = declararTools([
  {
    name: "crm_get_contact_import_instructions",
    category: "read",
    rotulo: "Preparar importação de contatos",
    explicacao:
      "Mostra o formato aceito e leva a pessoa até a tela que recebe a planilha e exibe o resultado por linha.",
    oQueToca: "Contatos da empresa",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_get_lead_import_instructions",
    category: "read",
    rotulo: "Preparar importação de oportunidades",
    explicacao:
      "Mostra as colunas aceitas e leva a pessoa ao funil para escolher o destino e conferir cada linha.",
    oQueToca: "Oportunidades do funil",
    risco: "seguro",
    pacotes: ["vender"],
    apenasHumano: true,
  },
  {
    name: "crm_get_product_import_instructions",
    category: "read",
    rotulo: "Preparar importação de produtos",
    explicacao:
      "Mostra como atualizar o catálogo pela planilha oficial e onde conferir itens criados, atualizados ou recusados.",
    oQueToca: "Produtos do catálogo",
    risco: "seguro",
    pacotes: ["vender"],
    apenasHumano: true,
  },
  {
    name: "crm_get_conversation_media_upload_instructions",
    category: "read",
    rotulo: "Preparar arquivo para uma conversa",
    explicacao:
      "Confere a conversa da empresa e orienta o envio privado do arquivo antes de anexá-lo à mensagem.",
    oQueToca: "Arquivos da conversa",
    risco: "seguro",
    pacotes: ["atender"],
    apenasHumano: true,
  },
  {
    name: "crm_get_template_media_upload_instructions",
    category: "read",
    rotulo: "Preparar imagem de um modelo",
    explicacao:
      "Informa formatos e tamanho aceitos para a imagem que acompanha um modelo externo sujeito a aprovação.",
    oQueToca: "Imagem do modelo de mensagem",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_get_ai_skill_import_instructions",
    category: "read",
    rotulo: "Preparar pacote de habilidade",
    explicacao:
      "Orienta a revisão e o envio humano de um pacote de habilidade sem transportar o arquivo pelo agente.",
    oQueToca: "Habilidades da inteligência artificial",
    risco: "seguro",
    pacotes: ["evoluir"],
    apenasHumano: true,
  },
  {
    name: "crm_preview_lead_bulk_action",
    category: "read",
    rotulo: "Visualizar mudança em várias oportunidades",
    explicacao:
      "Mostra a quantidade, os negócios afetados e os riscos de uma ação em grupo sem alterar nenhum dado.",
    oQueToca: "Oportunidades do funil",
    risco: "seguro",
    pacotes: ["vender", "organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_prepare_lead_bulk_action",
    category: "read",
    rotulo: "Preparar mudança em várias oportunidades",
    explicacao:
      "Valida a seleção e entrega a prévia para uma pessoa confirmar a ação em grupo na tela do funil.",
    oQueToca: "Oportunidades do funil",
    risco: "seguro",
    pacotes: ["vender", "organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_prepare_audit_export",
    category: "read",
    rotulo: "Preparar exportação da auditoria",
    explicacao:
      "Monta filtros e encaminha o download protegido do histórico, que pode conter dados pessoais da operação.",
    oQueToca: "Histórico de auditoria",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_get_privacy_export_status",
    category: "read",
    rotulo: "Consultar exportação de privacidade",
    explicacao:
      "Mostra o andamento e o comprovante seguro do pedido sem devolver arquivo privado, endereço ou link temporário.",
    oQueToca: "Pedido de privacidade",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_prepare_mcp_token_management",
    category: "read",
    rotulo: "Preparar gestão de tokens de acesso",
    explicacao:
      "Leva uma pessoa administradora à tela segura sem permitir que o acesso atual amplie ou revogue a si mesmo.",
    oQueToca: "Acessos externos da empresa",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_get_operational_diagnostics",
    category: "read",
    rotulo: "Consultar diagnóstico da operação",
    explicacao:
      "Resume falhas que pedem atenção sem mostrar credenciais, endereços privados ou detalhes do servidor.",
    oQueToca: "Saúde da operação",
    risco: "seguro",
    pacotes: ["organizar", "evoluir"],
    apenasHumano: true,
  },
] as const);
