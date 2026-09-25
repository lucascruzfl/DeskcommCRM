# Auditoria de onboarding — clínica de estética gerenciada

Base: `mcp/stable` em `0a7511a886f12f5f699bac2aceedf957d179a3d3` (25/09/2026). **CONFIRMADO** = leitura de código. **PROPOSTO** = classificação de uso para a clínica. Nenhum tenant real foi alterado.

## Matriz das 54 portas do catálogo de navegação

Fonte das áreas e funções: `lib/navigation/catalogo.ts`. Classificação versionada: `lib/managed-clients/presets.ts`. `B` é a avaliação conservadora do backend existente: role/RLS cobrem partes, mas não há autorização granular completa para o perfil gerenciado. A coluna UI indica somente apresentação por papel e `interface_settings`; ela **não** concede nem nega API, action ou RLS. MCP `sim` significa que há tools do domínio, não que reproduzam toda a página.

| Área real | Função no CRM | Cliente precisa? | Agência gerencia? | Backend | UI | MCP | Recomendação |
|---|---|---|---|---|---|---|---|
| Prospecção `/app/prospecting` | Busque empresas e conduza abordagens graduais com IA. | não | não | B | sim, apresentação | não | NÃO APLICÁVEL |
| Inbox `/app/inbox` | As conversas de WhatsApp, com você e a IA atendendo lado a lado. | sim | não | B | sim, apresentação | sim | CLIENTE |
| Radar `/app/radar` | Quem esfriou e ainda está aberto — o que corre risco de morrer sem resposta. | sim | não | B | sim, apresentação | sim | CLIENTE |
| Agenda `/app/agenda` | O que está marcado, com quem, e quem atende — seu e da equipe. | sim | não | B | sim, apresentação | sim | CLIENTE |
| Respostas rápidas `/app/templates` | Scripts salvos para responder mais rápido, seus ou da equipe. | sim | não | B | sim, apresentação | sim | CLIENTE |
| Funis `/app/kanban` | Seus funis de venda — clique em um para abrir o quadro de clientes. | sim | não | B | sim, apresentação | sim | CLIENTE |
| Campanhas `/app/campaigns` | Fale com uma lista de contatos que você escolhe, no ritmo do número. | não | sim | B | sim, apresentação | sim | AGÊNCIA |
| Contatos `/app/contacts` | As pessoas do outro lado da conversa e seu histórico. | sim | não | B | sim, apresentação | sim | CLIENTE |
| Tarefas `/app/tasks` | O que ficou combinado, com prazo — e o que já venceu sem ninguém fazer. | sim | não | B | sim, apresentação | sim | CLIENTE |
| Chamadas `/app/calls` | Histórico de ligações (voz por IA) com transcrição. | sim | sim | B | sim, apresentação | parcial | COMPARTILHADO |
| Produtos `/app/products` | O catálogo da loja, com o preço que o atendente de IA responde. | sim | sim | B | sim, apresentação | sim | COMPARTILHADO |
| Tipos de agendamento `/app/settings/tenant/agenda` | O que se pode marcar, quanto dura, onde acontece e quem atende. | sim | sim | B | sim, apresentação | sim | COMPARTILHADO |
| Comandas `/app/comandas` | O que foi feito, por quem, e quanto o cliente paga. | sim | não | B | sim, apresentação | parcial | CLIENTE |
| Financeiro `/app/settings/tenant/financeiro` | Contas, formas de pagamento e como cada lançamento é classificado. | sim | sim | B | sim, apresentação | não | COMPARTILHADO |
| Etapas do funil `/app/settings/tenant/pipelines` | As colunas de cada funil, o vocabulário do negócio e os motivos de perda. | não | sim | B | sim, apresentação | sim | AGÊNCIA |
| Agentes `/app/ai/agents` | Quem atende por você: instruções, modelo, ferramentas e publicação. | não | sim | B | sim, apresentação | sim | AGÊNCIA |
| Follow-ups `/app/ai/followups` | Como o agente retoma uma conversa que esfriou, para nenhuma morrer no silêncio. | não | sim | B | sim, apresentação | sim | AGÊNCIA |
| Roteadores `/app/ai/routers` | Qual agente pega qual conversa, e quando o humano assume. | não | sim | B | sim, apresentação | sim | AGÊNCIA |
| Credenciais `/app/ai/credentials` | A chave do provedor de IA que os agentes usam para pensar. | não | sim | B | sim, apresentação | parcial | AGÊNCIA |
| Provedores `/app/ai/providers` | Qual inteligência atende cada parte do sistema — e o que acontece se ela falhar. | não | sim | B | sim, apresentação | parcial | AGÊNCIA |
| Conhecimento `/app/ai/knowledge/sources` | Os materiais que o agente consulta antes de responder sobre o seu negócio. | não | sim | B | sim, apresentação | sim | AGÊNCIA |
| Memória `/app/ai/memory` | O que o agente já aprendeu sobre a sua operação e reaproveita. | não | sim | B | sim, apresentação | sim | AGÊNCIA |
| Skills `/app/ai/skills` | As ações que o agente pode executar sozinho durante o atendimento. | não | sim | B | sim, apresentação | sim | AGÊNCIA |
| Casos `/app/ai/cases` | Os atendimentos que o agente conduziu, do início ao desfecho. | sim | sim | B | sim, apresentação | sim | COMPARTILHADO |
| Alertas `/app/ai/inbox` | O que a IA encontrou e precisa de uma decisão sua. | sim | sim | B | sim, apresentação | parcial | COMPARTILHADO |
| Aviso no WhatsApp `/app/ai/cases/avisos` | Receber no WhatsApp quando o assistente abrir um caso. | não | sim | B | sim, apresentação | não | AGÊNCIA |
| Propostas `/app/ai/proposals` | Melhorias que a IA sugere para si mesma, esperando sua decisão. | não | sim | B | sim, apresentação | parcial | AGÊNCIA |
| Execuções `/app/ai/runs` | O que a IA fez — e, quando falhou, o que aconteceu e o que fazer. | não | sim | B | sim, apresentação | sim | AGÊNCIA |
| Uso e orçamento `/app/ai/usage` | Quanto a IA consumiu e qual é o teto de gasto do mês. | não | sim | B | sim, apresentação | parcial | AGÊNCIA |
| Conexões `/app/connections` | Seus números de WhatsApp: por QR ou canal oficial da Meta, com saúde, reconexão e templates. | não | sim | B | sim, apresentação | parcial | AGÊNCIA |
| Nuvemshop `/app/integrations/nuvemshop` | Conecte a loja para trazer pedidos e clientes para dentro do CRM. | não | não | B | sim, apresentação | parcial | NÃO APLICÁVEL |
| Webhooks `/app/webhooks` | Avise outros sistemas quando algo acontecer aqui dentro. | não | sim | B | sim, apresentação | sim | AGÊNCIA |
| Faturamento `/app/faturamento` | Quanto entrou, de que forma, e quanto cada pessoa tem a receber. | sim | não | B | sim, apresentação | não | CLIENTE |
| Desempenho `/app/metrics` | Funil e performance por atendente nos últimos 30 dias. | sim | não | B | sim, apresentação | não | CLIENTE |
| Meta Ads `/app/ads/meta` | Quanto custou cada resultado das campanhas que trazem gente para cá. | não | sim | B | sim, apresentação | não | AGÊNCIA |
| Atividades `/app/activities` | Relatório do que a equipe e os agentes fizeram no período: quanto, quem e de que tipo. | sim | não | B | sim, apresentação | parcial | CLIENTE |
| Evolução da IA `/app/ai/evolution` | Se o agente está melhorando, onde ele erra e o que falta ensinar. | não | sim | B | sim, apresentação | parcial | AGÊNCIA |
| Audit Log `/app/audit` | Quem fez o quê, quando — o histórico que não se apaga. | não | sim | B | sim, apresentação | parcial | AGÊNCIA |
| Perfil `/app/settings/profile` | Seu nome, idioma, fuso horário e avatar. | sim | não | B | sim, apresentação | não | CLIENTE |
| Segurança `/app/settings/security` | Verificação em duas etapas, códigos de recuperação e sessões. | sim | não | B | sim, apresentação | não | CLIENTE |
| Notificações `/app/settings/notifications` | Por onde e sobre o quê você quer ser avisado. | sim | não | B | sim, apresentação | não | CLIENTE |
| Equipe `/app/team` | Quem trabalha aqui, com qual papel e quanta conversa cada um aguenta. | sim | sim | B | sim, apresentação | sim | COMPARTILHADO |
| Distribuição de atendimento `/app/settings/atendimento` | Quem recebe cada cliente novo, e o que cada atendente enxerga. | não | sim | B | sim, apresentação | parcial | AGÊNCIA |
| Tags `/app/settings/tags` | O vocabulário de etiquetas da empresa: onde cada uma é usada e como renomear, juntar ou excluir. | sim | sim | B | sim, apresentação | sim | COMPARTILHADO |
| Organização `/app/settings/tenant` | Dados da empresa, retenção de dados e encarregado de LGPD. | não | sim | B | sim, apresentação | não | AGÊNCIA |
| Conversões `/app/settings/conversoes` | Devolver ao anúncio as vendas que ele trouxe, e marcar a origem de quem chega pelo site. | não | sim | B | sim, apresentação | não | AGÊNCIA |
| Meta Ads `/app/settings/meta-ads` | Conectar a conta de anúncios para ler o desempenho das campanhas. | não | sim | B | sim, apresentação | não | AGÊNCIA |
| Marca `/app/settings/marca` | O nome e a cor que sua empresa mostra dentro do sistema. | não | sim | B | sim, apresentação | não | AGÊNCIA |
| Billing `/app/settings/billing` | Plano e cobrança. | não | sim | B | sim, apresentação | não | AGÊNCIA |
| LGPD `/app/lgpd/requests` | Pedidos de exportação e exclusão de dados feitos por clientes. | sim | sim | B | sim, apresentação | parcial | COMPARTILHADO |
| API Tokens `/app/settings/api-tokens` | Chaves para outro sistema conversar com o seu CRM. | não | sim | B | sim, apresentação | parcial | AGÊNCIA |
| Trunk SIP `/app/settings/voip-trunk` | Credenciais do provedor SIP para chamadas de voz por IA. | não | sim | B | sim, apresentação | não | AGÊNCIA |
| Extensões `/app/extensions` | Guias instalados para orientar o trabalho no CRM, com permissões e estado visíveis. | não | sim | B | sim, apresentação | parcial | AGÊNCIA |
| Dados externos `/app/integracao-dados` | Conecte um banco de dados de outro sistema para o agente consultar em tempo real. | não | sim | B | sim, apresentação | sim | AGÊNCIA |

## Inventário além do menu

**CONFIRMADO:** o snapshot reproduzível em `2026-09-25-managed-clinic-surfaces.json` enumera **80 páginas do tenant**, **29 páginas de administração de plataforma** (incluindo `/admin/forbidden`), **358 route handlers HTTP**, **51 server actions de produção** e **71 diretórios de serviços**. Há **54 destinos** e **6 grupos** no catálogo de navegação; as outras 26 páginas do tenant são hubs, detalhes, formulários ou subconfigurações. Entre estas estão `/app/leads/[id]`, `/app/pipelines/[id]`, `/app/inbox/[id]`, `/app/campaigns/settings`, `/app/team/invite`, `/app/settings/atualizacao`, `/app/settings/canal-oficial`, `/app/settings/templates` e `/app/settings/tenant/whatsapp`. Elas herdam conceitualmente a área da matriz, mas ainda precisam de gate próprio antes de aplicar um preset.

As páginas protegidas de `/admin` cobrem dashboard, tenants (lista, criação, detalhe, saúde e agente), usuários, cadastro, configuração, destinos internos, e-mail, Google, Meta, marca, sistema, extensões, uso, inbox de suporte, incidentes, auditoria, LGPD e platform admins. São superfícies **E**: globais da instalação, fora da delegação ao cliente. O fato de existir uma tela `/admin/tenants/[id]/agent` não concede membership no tenant.

As 358 rotas incluem 74 sob `ai`, 31 `cron`, 22 `admin`, 20 `conversations`, 20 `agenda`, 14 `leads`, 12 `financeiro`, 11 `voice`, 11 `team` e 11 `contacts`; o JSON traz a lista integral. As 51 actions incluem onboarding atual, auth, team, shell, settings e integrações. O registry MCP tinha **232 tools em 22 domínios** na base; com as duas tools de leitura desta branch tem **234**. O código do registry, e não uma sessão MCP real, é a fonte desse snapshot: `lib/mcp/tools/index.ts` + `lib/mcp/tools/catalogo/index.ts`. `tools/list` real depende do token, papel, scopes e módulos opcionais ligados.

## Modelo de acesso encontrado

**CONFIRMADO:** `user_organizations` permite o mesmo `user_id` em várias `organization_id`, cada qual com `role` e `interface_settings`. `lib/auth/server.ts` carrega todos os vínculos ativos e resolve `active_org` somente entre eles. `components/shell/TenantSwitcher.tsx` já mostra organizações e chama `app/actions/shell/setActiveOrg.ts`; esta action reconsulta membership aceito, não revogado e org ativa antes de trocar o cookie. Portanto o gestor consegue trocar de tenant pelo painel **se for membro**. O seletor mostra o nome no desktop; no celular há ícone com nome no `aria-label` e no dropdown. Papel e tipo de cliente não aparecem juntos no cabeçalho atual.

Os papéis humanos de tenant são `viewer`, `agent`, `manager`, `admin`. O tipo TypeScript inclui ainda `ai_operator`, exclusivo de token efêmero do agente publicado; o CHECK de `user_organizations` não o aceita. `requireRole()` consulta `fn_user_role_in_org` no banco. Há RLS por tenant e alguns gates por papel, além de scopes de domínio/tool/capability no MCP. `interface_settings` é explicitamente **apresentação**: `lib/navigation/interface.ts` e `app/actions/settings/atualizarInterfaceDaEmpresa.ts` dizem que ocultar não nega página/API/action/RLS. Não existe capability persistida por área de negócio no membership. Resultado: autorização backend granular para este preset = **PARCIAL**.

O gap crítico tem prova concreta: `/app/ai/agents` e `GET /api/v1/ai/agents` exigem `manager`, mas a policy `tenant_isolation_ai_agents_select` da migration 0150 permite SELECT a qualquer membro da organização. A policy de `ai_agent_versions` também deixa qualquer membro ler. Um funcionário `agent` pode consultar o PostgREST diretamente com a sessão e ler `system_prompt`, configuração e versões mesmo que a UI o esconda. A matriz classifica essas áreas como **B**, não A. Outras áreas precisam de revisão análoga, incluindo knowledge, provider metadata, extensões, dados externos e páginas cujos menus têm `viewer` mas a API usa `manager`.

**CONFIRMADO pelo perfil derivado de `mcpPublicProfile`:** um token `agent` só com `mcp:read` lista `crm_list_knowledge_sources`, `crm_get_org_memory`, `crm_list_webhook_sources`, `crm_list_webhook_source_events` e `crm_describe_external_data`. Estas são áreas classificadas como AGÊNCIA. O escopo granular de domínio/tool pode estreitar um token emitido por um admin, mas o preset ainda não impõe esse limite ao vínculo nem a tokens já existentes. Portanto o requisito de negar MCP ao cliente para **cada** área da agência falha hoje.

Exemplo inverso: Campanhas aparece no catálogo com `minRole` implícito `viewer`, enquanto `GET/POST /api/v1/campaigns` exigem `manager` e a RLS acompanha. O cliente pode ver uma porta que leva a 403. Isso é inconsistência de UI, embora o efeito backend esteja negado. `crm_preflight_managed_client` nunca apresenta esse menu como autorização.

**Proposto, ainda não aplicado:** agência criadora com membership `admin` permanente; cliente inicial com `agent` e autorizações por área; primeiro convidado nunca `admin`. O schema não tem papel separado `owner`: `organizations.created_by` registra criador, e o vínculo `admin` dá gestão. A rota atual `POST /api/v1/admin/tenants` usa `fn_create_tenant_with_owner` e sempre cria o ator como `admin`; se `owner_email` é outra pessoa, o vínculo do ator é provisório e o convite da outra pessoa é `admin`. Portanto esse fluxo atual **não serve** ao perfil gerenciado: tornaria o cliente admin e removeria o gestor no aceite. Passar o e-mail do próprio gestor como `owner_email` preservaria o vínculo, mas só será seguro quando o convite restrito e os gates por área forem fechados.

O MCP atual **não cria tenant**. Existe criação oficial no painel/API (`POST /api/v1/admin/tenants`), com permissionamento de platform admin `full`, MFA da sessão e RPC idempotente; existe também `/api/v1/tenants/provision` por segredo de instalação, desligado por padrão, que atende outro contrato de integração e gera chave. O MCP **já convida membro** via `crm_invite_team_member`, restrito a `viewer/agent/manager`, usando o serviço oficial, mas sempre no tenant do token. `api_tokens` são tenant-scoped; `lib/mcp/auth.ts` deriva a organização do token. Não existe permissionamento MCP cross-organization de onboarding. `api_tokens.created_by` sozinho não é prova suficiente para um supertoken: a policy de INSERT `api_tokens_admin_only` não exige `created_by = auth.uid()`, de modo que um admin de tenant pode tentar gravar outro `created_by` pelo PostgREST. Uma capacidade de plataforma exige emissão e proveniência próprias antes de autorizar criação pelo MCP.

O convite normal guarda papel no token assinado e só cria membership no aceite; o usuário precisa autenticar com o e-mail correspondente (`app/actions/team/acceptInvite.ts`). `issueInvite()` não define senha nem confirma e-mail. Esta branch não chamou `issueInvite` nem alterou a lista de membros.

## Entrega desta branch e bloqueios

`lib/managed-clients/presets.ts` versiona `managed/aesthetic-clinic` em TypeScript e exige classificação para todo `NavDestinationId` por tipo. O preset prevê 14 áreas CLIENTE, 29 AGÊNCIA, 9 COMPARTILHADAS e 2 NÃO APLICÁVEIS. A classificação é **PROPOSTA para a rotina da clínica** sobre superfícies **CONFIRMADAS pelo código**, não é grant. A versão começa em `1.0.0`. Novos segmentos entram como outras entradas do registro, reutilizando futuramente o mesmo mecanismo de autorização; hoje não há mecanismo seguro para aplicar este primeiro perfil.

`crm_list_managed_client_presets` e `crm_preflight_managed_client` são tools MCP somente leitura, no padrão `crm_`. O preflight valida tipo, modo, nome, slug, e-mail e overrides contra a lista real de hrefs; calcula `plan_id` estável; devolve as quatro listas, gestor **proposto** como provisionador do token, ações humanas e conflitos. Nome/e-mail de cliente não entram no audit da tool (`redigirParaAuditoria`). Ele não consulta dados de outras organizações e **sempre devolve `can_execute: false`**. Não há `managed_client_create`, porque isso declararia seguro um perfil que o banco ainda deixa atravessar por leitura direta. Overrides mudam a visualização do plano, nunca acesso.

Bloqueios para a próxima fase, em ordem:

1. Definir capabilities por vínculo e aplicar a mesma decisão em páginas, APIs, server actions, MCP **e políticas RLS**; adicionar testes de negação por área e de acesso direto ao PostgREST.
2. Criar caminho de onboarding no service oficial que mantém o admin da agência, convida o cliente com papel restrito e persiste preset/version/overrides sem aplicar a tenants existentes. Criar recibo idempotente para etapas posteriores ao RPC e estado estruturado de falha parcial; o recibo atual da criação só cobre a organização.
3. Criar autorização MCP de plataforma específica para onboarding, com proveniência não forjável e checagem de platform admin `full` vigente. Não reutilizar um token de tenant como supertoken.
4. Só então habilitar confirmação explícita, criação, convite, auditoria de resultado e melhorias pequenas do seletor (empresa atual, papel, tipo) no painel.

**Grades:** A = backend + UI completos; B = backend parcial; C = somente UI; D = sem granularidade; E = superfície global/técnica não delegável. Esta auditoria não atribui A a nenhuma das 54 portas para o novo perfil; o sistema de `interface_settings` isoladamente é C, e a ausência de capability por área é D transversal. As telas globais `/admin` são E. Isso não diz que todo fluxo do CRM é inseguro; diz que os controles atuais não cumprem a fronteira específica CLIENTE × AGÊNCIA deste preset.
