# Provedor de internet — cliente gerenciado (Etapas 7A, 7B e 7C)

Destino: **infraestrutura + preset**. A operação comum continua inteira sem aplicar
este perfil. `managed/internet-provider`, versão `1.0.0`, business_type
`internet_provider`, usa o catálogo real de navegação. A clínica existente mantém
seu preset e suas áreas. Ao criar um novo tenant ISP pelo onboarding managed,
o pacote 7B é aplicado ao mesmo receipt; nenhum agente ou integração é criado.

| Classificação                        | Áreas                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente                              | Inbox, Radar de risco, respostas rápidas, Contatos, CRM/Funil, tarefas, métricas operacionais, atividades, perfil, segurança e notificações                                                                                                                                                                                                                                                     |
| Compartilhado, sujeito ao RBAC atual | Equipe, Chamadas (histórico de voz, mínimo manager), casos humanos da IA, Central de atendimento da IA, LGPD e Produtos                                                                                                                                                                                                                                                                         |
| Agência                              | Agentes, atendimento IA, roteadores, follow-ups, credenciais, provedores, conhecimento, memória, skills, avisos/propostas/execuções/uso/evolução da IA, configuração dos funis, conexões/canais, webhooks, campanhas, Meta Ads/conversões, auditoria, tags, routing, marca, assinatura da plataforma, API tokens, tronco de voz, integrações de dados e extensões, configurações da organização |
| Não aplicável inicialmente           | Prospecção, agenda, tipos de agendamento, Nuvemshop, comandas, Financeiro da organização e Faturamento                                                                                                                                                                                                                                                                                          |

**Calendário OFF inicialmente**, inclusive para o gestor. Agenda de instalação
fica para uma etapa futura. O financeiro genérico do CRM não representa faturas
de assinantes. Billing, boleto, PIX, confirmação de pagamento e desbloqueio
dependem de uma integração real futura; a assinatura da plataforma permanece
configuração da agência, sem equivalência com cobrança de assinantes.

Produtos é somente o catálogo comercial existente (`nome`, `descricao`,
`preco_cents`, moeda), onde ofertas de planos podem ser descritas. Leitura e
escrita respeitam seus papéis atuais (escrita a partir de manager). Não modela
assinatura, periodicidade, contrato, cobertura nem faturamento recorrente.
Chamadas é o histórico de voz já existente; não provisiona telefonia. Respostas
rápidas são scripts operacionais do atendente, não configuração de canais.

O modelo operacional é **IA + humano**, com Inbox e casos humanos existentes.
A configuração técnica permanece sob a agência. As classificações restringem
páginas, rotas/recursos, server actions, MCP e RLS pela policy managed existente;
menu visível nunca concede acesso nem eleva o RBAC.

## Contrato de onboarding

`MANAGED_CLIENT_PRESETS` em `lib/managed-clients/presets.ts` é a fonte tipada dos
IDs e tipos de negócio. O schema de criação deriva seu enum das chaves; o schema
de preflight deriva o enum de business_type, resolvido para o preset registrado.
MCP/API anunciam os mesmos schemas. Não existe novo endpoint de criação.

A RPC guarda a projeção dos IDs/tipos/modos oficiais como snapshot SQL gerado por
`pnpm exec tsx scripts/gerar-managed-onboarding-rpc.ts`. Ao registrar outro preset,
publique a saída em **nova migration**, apêndice do baseline antes do bloco final
`VARREDURA anon` e MANIFEST; nunca
edite a migration já aplicada. `lib/managed-clients/presets.test.ts` compara a
última definição das duas fontes SQL com o gerador, para impedir divergência.
As políticas persistidas não recebem backfill e continuam sendo a autoridade.

Criar exige platform_admin ativo com scope full, capability MCP, identidade do
provisionador e membership de origem aceito. MFA exigido bloqueia bearer sem
prova AAL2. Admin comum, manager ou agent não criam. Confirmação explícita,
idempotência, convite oficial agent e membership permanente admin do gestor
seguem a Fase 6. Cada token continua vinculado à sua organização; o gestor troca
pelo organization switcher e usa tokens próprios do tenant quando necessários.
Não se cria impersonation nem supertoken. Erros internos e links secretos de
convite não saem no resultado. O hash e a chave automática consideram o preset;
a mesma chave explícita com outro preset conflita.

## Pacote operacional 7B

O `crm_create_managed_client` aplica o pacote 7B no novo tenant ISP antes de
enviar o convite. Como a RPC de criação e as operações do pacote não compartilham
transação, falha parcial libera o claim e o retry do mesmo onboarding/receipt
retoma no mesmo tenant. Receipt concluído também revalida o pacote no retry.
`crm_configure_managed_internet_provider` continua disponível para preflight,
retry e reparo explícito com token MCP vinculado ao provedor alvo. A tool recebe a organização do
contexto autenticado; não aceita `organization_id` como entrada pública. O serviço
interno recebe esse ID explicitamente. Sem `confirm=true`, a tool informa o que será criado,
conflitos e dependências; com confirmação, exige platform admin full e vínculo
admin atual no tenant. Segunda execução reaproveita o que já existe. Configuração
do mesmo identificador que diverge vira conflito, sem sobrescrever personalização.
Num cliente recém-criado, o funil ISP vira padrão somente se `Pedidos`, semeado
pelo produto, estiver intacto e sem negócios. Um padrão já usado ou personalizado
é preservado e aparece como aviso no preflight.

O pacote cria o funil **Vendas — Internet** com as seis etapas abaixo e a sétima
**Não contratado**, necessária para fechar perdas no modelo real. **Cliente
ativado** é a única etapa de ganho. A etapa **Instalação** não recebe hint de IA,
pois a 7B não automatiza a instalação. Motivos de perda em
`crm_pipelines.settings.lost_reasons`: **Sem cobertura** (Nós), **Desistiu**
(Cliente) e **Sem retorno** (Ausência). A migration 0501 faz o trigger de perda
ler a configuração canônica do funil: a projeção operacional anterior removia
motivos categorizados e recusava esses fechamentos.

Tags em `organizations.settings.tags`: `lead`, `sem-cobertura`,
`aguardando-documentos`, `instalacao`, `cliente-ativo`, `suporte`, `financeiro`,
`cancelamento`. Campos em `crm_pipelines.settings.fields`: CEP, endereço,
número, complemento, bairro, cidade e plano de interesse para qualificação
comercial; código do cliente/contrato para preencher **após ativação**. Todos
são opcionais na 7B. CPF/CNPJ não entra no pacote.

**Sem cobertura** é perda com o motivo próprio. A tag `sem-cobertura` depende
de classificação humana: o evento `lead.stage_changed` traz a etapa de perda,
mas não distingue esse motivo dos outros. O fechamento preserva a origem;
`crm_retomar_lead` / `POST /api/v1/leads/{id}/retomar` cria novo negócio aberto
no mesmo tenant, ligado por `retomado_de_lead_id`, quando a área expandir.
As três regras de entrada em Aguardando documentos, Instalação e Cliente ativado
usam `lead.stage_changed` com IDs das etapas resolvidos no provisionamento e
`add_tag` no lead. Seus IDs são estáveis por tenant e a reaplicação não duplica
rules nem sobrescreve edições conflitantes.
O pacote não consulta cobertura e não classifica endereços sozinho. O operador
faz a decisão real. O plano deixa explícita a dependência de roteamento de
Comercial, Suporte/humano, Financeiro e Instalação, assim como os prazos de
follow-up. `ISP_FOLLOWUP_PLAN` é somente o plano pendente; não há flow
provisionado. O grafo real exige `wait.config.duration_ms` (ou faixa smart),
`internal_task.config.vence_em_dias` e o gatilho de silêncio exige
`trigger_config.params.threshold_minutes` (ver `lib/followup/graph-schema.ts` e
`lib/followup/api-schemas.ts`). Um DRAFT sem esses valores não representaria o
follow-up pedido; um grafo trigger → tarefa criaria tarefa imediatamente, sem
esperar dias na etapa. Na 7C devem ser aprovados os limiares e prazos antes de
criar flows DRAFT/INATIVOS, sem canal nem agente.
Nenhuma mensagem automática é enviada na 7B.

Agenda/calendário fica OFF. Billing, PIX, ERP, OLT, ONU, RADIUS e consulta
real de cobertura não são instalados por este pacote.

## 7C — IA + humano

### Implementado na 7C

`crm_configure_managed_internet_provider_ai` é a etapa explícita e retomável do
tenant `managed/internet-provider`. Com `confirm=false`, consulta a policy atual,
o administrador da agência, o funil 7B, provider/model/credencial reais, canal,
fontes de conhecimento e roteiros opcionais do tenant, e informa pendências e
conflitos sem escrever. Com `confirm=true`, prepara somente o que foi informado.
Não faz parte do onboarding automático 7B.

Quando há provider, model e credencial válidos, prepara cinco `mcp_agent` com
versões `draft`: **Atendimento geral ISP** (reserva), **Comercial**, **Suporte**,
**Financeiro** e **Instalação**. Todos nascem fora do ar, com `cases_enabled` e
`handoff_tool_enabled`, sem follow-up ativo. Comercial usa o Operador canônico
para escritas no CRM; os outros papéis ficam sem Operador. Os prompts usam apenas
contexto e conhecimento real. Sem material vinculado, não há FAQ de exemplo.
As capacidades de Comercial permitem usar o funil e seus campos oficiais;
Suporte não recebe operação de rede; Financeiro não recebe ferramenta de
cobrança; Instalação não recebe agenda.

Se um `channel_session_id` real for informado, o configurador prepara um
`ai_routers` **inativo** no mesmo tenant, com quatro `ai_router_members`: `comercial`,
`suporte`, `financeiro`, `instalacao`. `fallback_agent_id` aponta para Atendimento
geral ISP. A configuração `{}` herda os defaults do runtime: sticky ligado e
confiança mínima 0,6. Sem canal, o preflight registra a pendência e nenhum router
é criado. Um canal sem estado WORKING aparece como pendência de ativação.
`flow_pointer_id` é opcional e só aceita roteiro `atendimento` do mesmo tenant.

Prazos explícitos permitem preparar rascunhos de follow-up **internos**, com
gatilho, espera, tarefa para o dono do lead e fim, sem enviar mensagem. Existem
quatro propostas: Plano apresentado sem resposta, Aguardando documentos,
Instalação parada e recuperação futura de Sem cobertura. As três primeiras usam
entrada na etapa do funil ISP; a recuperação de Sem cobertura fica em gatilho
manual porque o evento de perda não traz o motivo de modo seguro. A proposta de
Plano apresentado cancela ao receber resposta. Cada prazo precisa de
`wait_minutes` e `task_due_days` fornecidos pelo operador; sem eles não nasce
flow. Publicar e ativar os flows usa as ferramentas genéricas do motor.

IDs de agente, versão, router, membro e flow são estáveis por tenant. O preflight
compara os drafts existentes; alteração manual em prompt, tools, membro, router
ou flow vira conflito, sem sobrescrita. A criação usa a validação oficial de
provider/model/credencial e os schemas de agente e follow-up existentes.
Nenhuma migration foi necessária: `ai_agents.config` e
`ai_agent_versions.provisioning_origin` guardam a identidade do pacote.

O caso humano é retaguarda: a IA continua conversando, e a resposta da equipe
volta ao turno por `case_reply_turn`. O handoff usa a passagem canônica, entrega
briefing e silencia a IA. Só uma pessoa pode chamar
`crm_resume_ai_attendance`; o retorno grava a continuidade para o próximo turno.
Fila, disponibilidade, rodízio e acompanhamento seguem as primitivas atuais.

### Configurável na 7D

O primeiro provedor escolherá provider, modelo, credencial validada ou chave
real da instalação, canal WORKING, fontes de conhecimento reais, equipe humana,
políticas e prazos. A sequência é: preflight e prepare; revisar e testar cada
versão com `crm_test_ai_agent_version` (dry run); publicar versões pela tool
genérica; ativar agentes; conferir o router inativo na tela, testar intenções e
reserva; ativar o router explicitamente; revisar, publicar e ativar follow-ups
aprovados; fazer piloto com conversa real. O pacote não antecipa essas decisões.

### Futuro ERP/ISP

Cobertura por API, ERP, billing, boleto, PIX, confirmação de pagamento,
desbloqueio, ONU, OLT, RADIUS, provisionamento técnico e agenda técnica
integrada continuam fora. O calendário ISP segue OFF.

## Especificação original da 7A

Funil: **Novo lead → Verificar cobertura → Plano apresentado → Aguardando
documentos → Instalação → Cliente ativado**.

Fechamentos: **Sem cobertura**, **Desistiu**, **Sem retorno**.

Tags: `lead`, `sem-cobertura`, `aguardando-documentos`, `instalacao`,
`cliente-ativo`, `suporte`, `financeiro`, `cancelamento`.

| Intenção futura    | Destino        |
| ------------------ | -------------- |
| contratar internet | Comercial      |
| internet caiu      | Suporte/humano |
| segunda via        | Financeiro     |
| quando instalar    | Instalação     |

Lead fora da cobertura é preservado, classificado e recuperável para
expansão, sem descarte. O pacote não consulta cobertura ou fatura, não integra ERP,
ONU, OLT ou RADIUS e não automatiza rede, cobrança ou calendário de instalação.

O [checklist do onboarding](../architecture/managed-client-onboarding.md) e o
[mapa vivo](../architecture/managed-client-onboarding.architecture.json) descrevem
entrada, convite, policy, memberships, auditoria visível e retorno por retry.
