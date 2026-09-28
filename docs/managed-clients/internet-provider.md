# Provedor de internet — cliente gerenciado (Etapa 7A)

Destino: **infraestrutura + preset**. A operação comum continua inteira sem aplicar
este perfil. `managed/internet-provider`, versão `1.0.0`, business_type
`internet_provider`, usa o catálogo real de navegação. A clínica existente mantém
seu preset e suas áreas. Nenhum funil, tag, agente ou integração de ISP é criado
por este preset nesta etapa.

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

## Alvo da próxima etapa (planejado, não implementado)

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

Lead fora da cobertura deverá ser preservado, classificado e recuperável para
expansão, sem descarte. Esta PR não consulta cobertura ou fatura, não integra ERP,
ONU, OLT ou RADIUS e não automatiza rede, cobrança ou calendário de instalação.

O [checklist do onboarding](../architecture/managed-client-onboarding.md) e o
[mapa vivo](../architecture/managed-client-onboarding.architecture.json) descrevem
entrada, convite, policy, memberships, auditoria visível e retorno por retry.
