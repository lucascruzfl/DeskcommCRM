import { declararTools, type McpToolCatalogEntry } from "./tipos";

type Entrada = Pick<McpToolCatalogEntry, "name" | "category" | "rotulo" | "explicacao" | "oQueToca"> & {
  risco?: McpToolCatalogEntry["risco"];
};

const entradas: Entrada[] = [
  { name: "crm_list_ai_providers", category: "read", rotulo: "Ver empresas de inteligência disponíveis", explicacao: "Mostra as empresas de inteligência que esta instalação sabe usar e se cada uma está pronta para atender.", oQueToca: "Inteligência artificial" },
  { name: "crm_get_ai_provider", category: "read", rotulo: "Consultar empresa de inteligência", explicacao: "Explica como uma empresa de inteligência está configurada e quais recursos ela oferece nesta instalação.", oQueToca: "Inteligência artificial" },
  { name: "crm_list_ai_models", category: "read", rotulo: "Ver modelos de inteligência", explicacao: "Mostra os modelos realmente disponíveis, os que usam ferramentas e os que conseguem entender imagens.", oQueToca: "Modelos de inteligência" },
  { name: "crm_get_ai_model", category: "read", rotulo: "Consultar modelo de inteligência", explicacao: "Confere um modelo específico, suas capacidades, seu custo conhecido e se ele ainda pode ser escolhido.", oQueToca: "Modelos de inteligência" },
  { name: "crm_list_ai_credentials", category: "read", rotulo: "Ver chaves cadastradas com segurança", explicacao: "Mostra somente nome, empresa, estado e final identificador das chaves, sem revelar nenhum valor secreto.", oQueToca: "Chaves de inteligência" },
  { name: "crm_get_ai_credential", category: "read", rotulo: "Consultar chave cadastrada com segurança", explicacao: "Confere o estado e a compatibilidade de uma chave cadastrada sem mostrar o conteúdo usado para autenticar.", oQueToca: "Chaves de inteligência" },
  { name: "crm_validate_agent_ai_configuration", category: "read", rotulo: "Validar inteligência do agente", explicacao: "Confere empresa, modelo, chave e capacidades antes de qualquer rascunho ser colocado em funcionamento.", oQueToca: "Configuração do agente" },
  { name: "crm_list_ai_agents", category: "read", rotulo: "Ver agentes de inteligência", explicacao: "Mostra os agentes da empresa e deixa claro quais estão publicados, pausados, ativos ou arquivados.", oQueToca: "Agentes de inteligência" },
  { name: "crm_get_ai_agent", category: "read", rotulo: "Consultar agente de inteligência", explicacao: "Mostra a identidade e o estado atual de um agente sem revelar qualquer chave usada por ele.", oQueToca: "Agentes de inteligência" },
  { name: "crm_create_ai_agent", category: "write", rotulo: "Criar agente em rascunho", explicacao: "Cria um novo agente com sua primeira versão ainda fora do ar, depois de conferir todas as referências.", oQueToca: "Agentes de inteligência" },
  { name: "crm_update_ai_agent", category: "write", rotulo: "Atualizar dados do agente", explicacao: "Altera nome, descrição ou prioridade do agente sem modificar o conteúdo de uma versão já publicada.", oQueToca: "Agentes de inteligência" },
  { name: "crm_duplicate_ai_agent", category: "write", rotulo: "Duplicar agente em rascunho", explicacao: "Copia o agente e sua configuração para um novo rascunho que nasce fora do ar e pode ser revisado.", oQueToca: "Agentes de inteligência" },
  { name: "crm_pause_ai_agent", category: "write", rotulo: "Pausar agente publicado", explicacao: "Interrompe novos atendimentos automáticos sem apagar a versão publicada nem o histórico do agente.", oQueToca: "Agentes de inteligência" },
  { name: "crm_activate_ai_agent", category: "write", rotulo: "Ativar agente publicado", explicacao: "Coloca novamente em funcionamento um agente que já tem uma versão publicada e estava pausado.", oQueToca: "Agentes de inteligência", risco: "critico" },
  { name: "crm_archive_ai_agent", category: "write", rotulo: "Arquivar agente de inteligência", explicacao: "Tira o agente de funcionamento e preserva versões e histórico para consulta e auditoria posteriores.", oQueToca: "Agentes de inteligência", risco: "critico" },
  { name: "crm_list_ai_agent_versions", category: "read", rotulo: "Ver versões do agente", explicacao: "Mostra todas as versões do agente, seus estados e as configurações que cada uma carrega.", oQueToca: "Versões do agente" },
  { name: "crm_get_ai_agent_version", category: "read", rotulo: "Consultar versão do agente", explicacao: "Mostra o texto de orientação, o modelo, as capacidades e os limites de uma versão específica.", oQueToca: "Versões do agente" },
  { name: "crm_get_published_ai_agent_version", category: "read", rotulo: "Ver versão publicada do agente", explicacao: "Encontra a versão que está publicada sem exigir que a pessoa já saiba seu identificador interno.", oQueToca: "Versões do agente" },
  { name: "crm_create_ai_agent_version", category: "write", rotulo: "Criar versão em rascunho", explicacao: "Cria uma nova versão fora do ar e confere modelo, chave, funis e materiais antes de salvar.", oQueToca: "Versões do agente" },
  { name: "crm_update_ai_agent_version", category: "write", rotulo: "Editar versão em rascunho", explicacao: "Altera uma versão que ainda não foi publicada e valida novamente todas as referências escolhidas.", oQueToca: "Versões do agente" },
  { name: "crm_preflight_ai_agent_version", category: "read", rotulo: "Conferir versão antes de publicar", explicacao: "Executa todas as conferências de uma versão existente e explica qualquer impedimento antes da publicação.", oQueToca: "Versões do agente" },
  { name: "crm_publish_ai_agent_version", category: "write", rotulo: "Publicar versão do agente", explicacao: "Publica de forma atômica uma versão validada, sem ativar novamente um agente que esteja pausado.", oQueToca: "Versões do agente", risco: "critico" },
  { name: "crm_test_ai_agent_version", category: "write", rotulo: "Testar versão do agente", explicacao: "Executa uma prévia controlada sem enviar mensagem real nem produzir qualquer efeito externo no canal.", oQueToca: "Versões do agente" },
  { name: "crm_list_ai_agent_runs", category: "read", rotulo: "Ver execuções do agente", explicacao: "Mostra execuções recentes, estado, consumo e erros básicos sem expor chaves ou outros segredos.", oQueToca: "Execuções do agente" },
  { name: "crm_get_ai_agent_run", category: "read", rotulo: "Consultar execução do agente", explicacao: "Mostra o resultado e o consumo de uma execução específica para facilitar diagnóstico e acompanhamento.", oQueToca: "Execuções do agente" },
];

export const TOOLS_IA = declararTools(entradas.map((entry) => ({
  ...entry,
  risco: entry.risco ?? (entry.category === "read" ? "seguro" : "atencao"),
  pacotes: ["organizar"] as const,
  apenasHumano: true,
})));
