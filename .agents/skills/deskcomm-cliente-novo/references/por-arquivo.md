# Arquivos e MCP — configuração comprovada e limites atuais

## Como revalidar a capacidade

Auditoria na base `mcp/stable` em `4431d9cf5155449610b2bdb604d7f317d1aa741d`, após Fase 6 e
Etapa 7A. A afirmação antiga de que MCP só opera, sem configurar, não descreve este código.
O registro real é `lib/mcp/tools/index.ts`; a apresentação está em `lib/mcp/tools/catalogo/`.
`lib/mcp/registry.ts`, `policy.ts` e `auth.ts` filtram o que cada token pode receber e executar.

Antes de aplicar um pacote, peça **`tools/list` com o token autorizado do tenant alvo**. Confira
nome, schema, papel, scopes, capabilities e área managed; não infira autorização só porque a tool
existe no repo. No clone, revalide os módulos abaixo no registro e no handler, não só no catálogo
de apresentação. Sem tool disponível/autorizada, siga `pela-tela.md` com a pessoa responsável.

Token de API (`dsk_…`) é vinculado a uma organização. Tem `mcp:read`/`mcp:write`, teto de role e,
quando configurados, scopes granulares de domínio, allowlist `tool:` e capabilities específicas.
Em managed, área agency exige admin e o provisionador não pode ter token acima do membership
atual aceito. Classificação `not_applicable` bloqueia inclusive admin. Papéis e escopos da criação
gerenciada estão detalhados em `cliente-gerenciado.md`.

## O que as ferramentas reais configuram

A coluna de papel é o mínimo MCP antes dos demais gates. Leituras exigem `mcp:read`; escritas,
`mcp:write`. Publicar/ativar exige ainda a capability indicada. Esse contrato não muda o guard
das rotas de tela, que podem exigir admin para escrita.

| Peça | Ferramentas verificadas no registro e handler | Papel e limites |
| --- | --- | --- |
| Onboarding gerenciado | `crm_list_managed_client_presets`, `crm_preflight_managed_client`, `crm_create_managed_client` (`managed-clients.ts`) | Leituras agent; criação manager **mais platform_admin ativo full**, `managed_client_onboarding` e confirmação. Ver `cliente-gerenciado.md` |
| IA + humano ISP gerenciado | `crm_configure_managed_internet_provider_ai` (`managed-clients.ts`) | Só tenant `managed/internet-provider`, platform admin full com membership admin atual e capability `managed_client_onboarding`. `confirm=false` faz preflight sem escrita; `confirm=true` prepara drafts, nunca publica nem envia. Provider/model/credencial são escolha explícita; canal e prazos reais são opcionais para preparar parcialmente e obrigatórios para seus respectivos vínculos. |
| Agentes | `crm_list_ai_agents`, `crm_get_ai_agent`, `crm_create_ai_agent`, `crm_update_ai_agent`, `crm_duplicate_ai_agent` (`ia.ts`) | manager; cria/duplica em rascunho, não publica |
| Versões | `crm_list_ai_agent_versions`, `crm_get_ai_agent_version`, `crm_get_published_ai_agent_version`, `crm_create_ai_agent_version`, `crm_update_ai_agent_version`, `crm_preflight_ai_agent_version` (`ia.ts`) | manager; só edita rascunho, revalida referências do tenant |
| Prévia, publicação e estado | `crm_test_ai_agent_version`, `crm_publish_ai_agent_version`, `crm_activate_ai_agent`, `crm_pause_ai_agent`, `crm_archive_ai_agent` (`ia.ts`) | manager; prévia controlada sem envio; publicar exige `agent_publication`, ativar `agent_activation`, arquivar `destructive_operations`. Publicar não é ativar |
| Modelos, provedores e credenciais | `crm_list_ai_providers`, `crm_get_ai_provider`, `crm_list_ai_models`, `crm_get_ai_model`, `crm_list_ai_credentials`, `crm_get_ai_credential`, `crm_validate_agent_ai_configuration` (`ia.ts`) | manager; consulta/validação e metadados seguros. **Não cria credencial nem altera configuração de provedores**: use tela |
| Roteador de agentes/intenção | O configurador ISP prepara um router inativo; não há tool genérica de criação/edição de `ai_routers` neste registro | **Agente de IA › Roteadores**, pela tela para revisão, teste e ativação; não confundir com distribuição de atendentes |
| Distribuição de atendentes | `crm_get_routing_config`, `crm_list_routing_destinations`, `crm_update_routing_config`, `crm_update_channel_routing`, `crm_simulate_routing` (`automacoes-roteamento.ts`) | manager; configura/simula routing humano. Não cria o classificador de intenções de IA |
| Fluxos de follow-up | `crm_list_followup_flows`, `crm_get_followup_flow`, `crm_create_followup_flow`, `crm_duplicate_followup_flow`, `crm_update_followup_flow`, `crm_preflight_followup_flow`, `crm_publish_followup_flow`, `crm_set_followup_flow_active`, `crm_delete_followup_flow` (`followup-administracao.ts`) | manager; criar/duplicar deixa rascunho. Publicar/reativar exige `automation_activation`, excluir `destructive_operations`. Publicar pode armar execução futura; não dispara mensagem imediata |
| Inscrições de follow-up | `crm_list_followup_enrollments`, `crm_get_followup_enrollment`, `crm_control_followup_enrollment` (`followup-administracao.ts`); `crm_schedule_followup`, `crm_enroll_followup_flow`, `crm_cancel_followup` (`retencao.ts`) | Administração manager; agendar/inscrever/cancelar mínimo `ai_operator`. Controlar inscrição não força envio imediato |
| Conhecimento | `crm_list_knowledge_sources`, `crm_search_knowledge` (`evolucao.ts`); `crm_get_knowledge_source`, `crm_create_knowledge_source`, `crm_update_knowledge_source`, `crm_replace_knowledge_faq`, `crm_reindex_knowledge_source`, `crm_archive_knowledge_source` (`knowledge-administracao.ts`) | Consultar/buscar agent, administração manager. Criação textual FAQ/documento emite indexação assíncrona; arquivar exige `destructive_operations`. Esperar a indexação |
| Arquivo binário de conhecimento | `crm_get_knowledge_upload_instructions` (`knowledge-administracao.ts`) | manager; só orienta upload pelo endpoint oficial `/api/v1/ai/knowledge/sources/upload` (multipart) ou tela. Não transporta arquivo/base64 nem conclui upload |
| Memória | `crm_get_org_memory`, `crm_save_org_memory` (`evolucao.ts`) | Ler agent; salvar mínimo `ai_operator`, cria **aprendizado ativo** com origem agent. Não publica o **Documento da organização** versionado: use Memória na tela para esse documento |
| Funis | `crm_list_pipelines`, `crm_get_pipeline`, `crm_create_pipeline`, `crm_update_pipeline`, `crm_archive_pipeline`, `crm_update_pipeline_schema` (`pipelines.ts`) | Ler agent, escrever manager; criação comum traz etapas iniciais oficiais. O onboarding ISP aplica seu pacote; `crm_configure_managed_internet_provider` serve para preflight/retry/reparo; schema atualiza campos, vocabulário e motivos; arquivar exige `destructive_operations` |
| Etapas | `crm_list_stages`, `crm_create_stage`, `crm_update_stage`, `crm_archive_stage` (`operacao.ts`) | Ler agent, escrever manager; ordem, nome, flags de ganho/perda e aviso interno. Arquivar exige `destructive_operations`. **Mapa dos passos do agente** continua pela tela, sem tool específica |
| Automações | `crm_discover_automation_triggers`, `crm_discover_automation_actions`, `crm_preflight_automation_rule`, `crm_create_automation_rule`, `crm_update_automation_rule`, `crm_duplicate_automation_rule`, `crm_simulate_automation_rule` (`automacoes-roteamento.ts`); `crm_set_automation_rule_active` (`operacao.ts`) | manager; criar deixa regra inativa; ativação exige `automation_activation`. Preflight informa capabilities das ações (incluindo `send_messages` quando há envio); confira o efeito antes de ativar. Simulação não executa efeitos |
| Tags | `crm_manage_tags` (`governance.ts`); `crm_list_tag_vocabulary`, `crm_update_tag`, `crm_merge_or_delete_tag` (`tags.ts`) | Aplicar/remover no contato/lead/conversa e consultar vocabulário: agent. Renomear/cor: manager; juntar/excluir exige `destructive_operations`. O pacote ISP cria o vocabulário, mas a classificação de cada lead usa a decisão real do operador |
| Ofertas/Produtos | `crm_list_products`, `crm_get_product`, `crm_create_product`, `crm_update_product`, `crm_delete_product` (`templates-comercio-administracao.ts`) | Ler viewer, escrever manager; excluir exige `destructive_operations`. Catálogo comercial simples; nenhuma consulta de cobertura, contrato ou fatura ISP |
| Agenda (quando aplicável ao nicho) | `crm_get_event_type`, `crm_create_event_type`, `crm_update_event_type`, `crm_set_event_type_active`, `crm_list_availability`, `crm_update_availability` (`agenda-administracao.ts`) | Ler agent, escrever manager. Não habilita área bloqueada pelo preset: ISP permanece com calendário OFF |
| Skills do produto | `crm_get_ai_skill`, `crm_save_ai_skill`, `crm_list_ai_skill_versions`, `crm_restore_ai_skill_version` (`skill-versions.ts`) | Consulta de versões agent, demais manager; salvar/restaurar exige `agent_publication`. `crm_get_ai_skill_import_instructions` só orienta importar; `.zip` segue pela superfície oficial |

`ai_operator` é papel de runtime do agente, não um papel para convidar pessoa. Para cliente MCP
humano, use manager/admin conforme o contrato e a área managed. O teste sandbox propõe ações;
não prova entrega ao WhatsApp, handoff ou comportamento do worker. Complete a prova operacional
pela tela, em ambiente de teste, após autorização para publicação/ativação.

## Arquivos ajudam a preparar; não substituem o serviço oficial

- Prepare prompt, FAQ, textos e desenho dos fluxos em `pacote-<cliente>.md`, com dados fictícios
  nos exemplos. Não grave credenciais, tokens, dados de clientes ou URLs privadas no pacote.
- Aplique os trechos suportados pelas tools autorizadas e conclua pela tela o que não tem tool:
  credenciais, seleção dos provedores por ponto de uso, roteador de IA, mapa dos passos do agente,
  documento versionado da memória e upload/importação quando exigidos.
- Não há comando `pnpm cliente:montar <pacote.json>` nesta base. Isso **não** impede configuração
  parcial por MCP; impede prometer um importador único que monta e publica tudo.
- Não configure por SQL. Publicação usa validação oficial e versão publicada imutável; credencial
  usa cifra/validação; conhecimento textual emite eventos para indexar. Escrever tabela direto
  contorna esses contratos. Se precisar auditar dados, prefira leituras MCP ou agregados do guia
  `deskcomm-metricas`, sem abrir/copiar `.env*` ou expor dado pessoal.

## REST e token não são uma porta única

É incorreto dizer que `dsk_…` funciona só em `/api/mcp` ou que todas as configurações exigem
cookie de admin. Existem rotas com autenticação dual e guards próprios. Para medir no clone:

```bash
git grep -ln 'auth-dual' -- app/api/v1
```

Confira também `lib/auth/public-paths.ts`, que permite ao bearer chegar ao handler, e o guard da
rota concreta. O comando é um inventário do helper, não prova de que toda rota REST aceita token.
Não extrapole autorização do MCP para REST; na falta de confirmação do endpoint, use tela/tool.
