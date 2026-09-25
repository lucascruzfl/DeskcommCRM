# Fase 2 — estado medido da autorização gerenciada

Base `mcp/stable` `0a7511a886f12f5f699bac2aceedf957d179a3d3`; trabalho sobre `457bcfa9dece532784bef225797cda8535f17a1d`.

**Onboarding real permanece bloqueado.** A migration 0410 cria `managed_client_policies` sem backfill; nenhum tenant existente recebe preset. A linha guarda tipo de negócio, modo, preset, versão, snapshot das áreas, overrides, autor e data. O snapshot é produzido por `buildManagedAreaPolicy()` a partir do catálogo tipado de 54 áreas. UI e MCP leem a mesma linha. O banco lê a mesma coluna `areas` em `fn_managed_area_allowed`. `can_execute` continua falso porque não há cobertura completa das rotas, actions, tabelas e RPCs.

Em runtime, `areas` persistido é a autoridade tanto no TypeScript quanto na RLS. `preset_version` registra de qual versão saiu o snapshot; atualizar o código do preset não muda silenciosamente decisões de tenants já criados. Novo onboarding continua exigindo preset válido e versão atual.

## Matriz TABLE/RPC → área → policy atual → necessária → teste

| TABLE/RPC | Área | Policy anterior | Policy necessária nesta fase | Teste |
|---|---|---|---|---|
| `ai_agents` | Agentes | membro podia ler; admin escrevia | membro **e** `fn_managed_area_allowed(..., '/app/ai/agents')` | Postgres real: agent 0, admin 1, outro tenant 0 |
| `ai_agent_versions` | Agentes | membro podia ler; admin escrevia | mesmo gate restritivo | Postgres real: agent 0, admin 1, outro tenant 0 |
| `ai_provider_credentials` | Credenciais | RLS tenant/role histórica | gate restritivo de Credenciais | baseline install/reapply; DML específico pendente |
| `ai_knowledge_sources` | Conhecimento | RLS tenant/role histórica | gate restritivo de Conhecimento | baseline install/reapply; DML específico pendente |
| `ai_knowledge_versions` | Conhecimento | RLS tenant/role histórica | gate restritivo de Conhecimento | baseline install/reapply; DML específico pendente |
| `ai_chunks` | Conhecimento | RLS tenant/role histórica | gate restritivo de Conhecimento | baseline install/reapply; DML específico pendente |
| `ai_budgets` | Uso e orçamento | RLS tenant/role histórica | gate restritivo de Uso e orçamento | baseline install/reapply; DML específico pendente |
| `ai_agent_runs` | Execuções | RLS tenant/role histórica | gate restritivo de Execuções | baseline install/reapply; DML específico pendente |
| `llm_calls` | Execuções / Uso | SELECT de membro isolado por tenant | gate restritivo de Execuções e apenas SELECT autenticado | Postgres real: agent 0, admin 1, outro tenant só o próprio |
| `api_tokens` | API Tokens | admin tenant | gate restritivo de API Tokens | baseline install/reapply; DML específico pendente |
| `managed_client_policies` | Política | inexistente | SELECT de membro; mutação só `service_role` após gate da aplicação | Postgres real: `authenticated` não tem UPDATE; isolamento de SELECT |
| `ai_agent_assignable_directory` | Funis (picker operacional) | inexistente | projeção mínima RLS por membership + área Funis; trigger a mantém | Postgres real: agent 1 linha; sem prompt/credencial; versão sincronizada |
| Demais tabelas das 29 áreas | Conforme catálogo | diversas | inventário e gate por área ainda incompletos; ver 0412 abaixo | **PARCIAL** |
| RPCs administrativos | Conforme função | diversas | rever EXECUTE e autorização interna por membership/área | **PENDENTE** |

As policies novas são `AS RESTRICTIVE FOR ALL`: compõem por AND com as policies permissivas históricas. A migration não transforma uma policy de escrita em SELECT por OR.


## Inventário adicional da migration 0412

A tabela abaixo registra os 58 gates adicionais. A policy atual após a migration é a RLS anterior da tabela combinada com `managed_area_gate AS RESTRICTIVE FOR ALL`. A policy necessária para o cliente gerenciado é manter o isolamento anterior e exigir `fn_managed_area_allowed(organization_id, área)` em SELECT e mutações. O teste de catálogo consulta `pg_policies` no Postgres descartável para todas as linhas; automações têm ainda teste de leitura, escrita e isolamento com três atores. Isso **não** prova as RPCs ou recursos mistos.

| TABLE | ÁREA | POLICY ATUAL | POLICY NECESSÁRIA | TESTE |
|---|---|---|---|---|
| `ai_faq_items` | `/app/ai/knowledge/sources` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `knowledge_searches` | `/app/ai/knowledge/sources` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `ai_invocations` | `/app/ai/runs` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `ai_purpose_bindings` | `/app/ai/providers` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `ai_routers` | `/app/ai/routers` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `ai_router_members` | `/app/ai/routers` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `ai_router_decisions` | `/app/ai/routers` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `org_memory_entries` | `/app/ai/memory` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `org_memory_pointers` | `/app/ai/memory` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `org_memory_versions` | `/app/ai/memory` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `skill_pointers` | `/app/ai/skills` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `skill_versions` | `/app/ai/skills` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `skill_activations` | `/app/ai/skills` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `followup_flow_pointers` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `followup_flow_versions` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `followup_enrollments` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `followup_enrollment_events` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `automation_rules` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies + DML/RLS |
| `automation_rule_runs` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `config_aviso_de_caso` | `/app/ai/cases/avisos` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `flywheel_distiller_proposals` | `/app/ai/proposals` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `flywheel_judge_verdicts` | `/app/ai/evolution` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `org_guardrail_layers` | `/app/ai/agents` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `playbook_versions` | `/app/ai/agents` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `playbook_pointers` | `/app/ai/agents` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `disclosure_template_versions` | `/app/ai/agents` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `disclosure_template_pointers` | `/app/ai/agents` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `channel_knobs` | `/app/connections` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `reentry_template_versions` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `reentry_template_pointers` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `reentry_knob_versions` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `reentry_knob_pointers` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `promise_table_versions` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `promise_table_pointers` | `/app/ai/followups` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `campaigns` | `/app/campaigns` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `campaign_recipients` | `/app/campaigns` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `campaign_channel_sessions` | `/app/campaigns` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `campaign_templates` | `/app/campaigns` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `campaign_suppressions` | `/app/campaigns` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `prospecting_settings` | `/app/prospecting` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `prospecting_campaigns` | `/app/prospecting` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `prospecting_candidates` | `/app/prospecting` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `tenant_integrations` | `/app/integrations/nuvemshop` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `orders` | `/app/integrations/nuvemshop` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `nuvemshop_products` | `/app/integrations/nuvemshop` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `webhook_sources` | `/app/webhooks` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `webhook_lead_captures` | `/app/webhooks` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `webhook_events_log` | `/app/webhooks` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `ad_insights_connections` | `/app/ads/meta` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `ad_hierarchy_cache` | `/app/ads/meta` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `ad_platform_connections` | `/app/settings/meta-ads` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `ad_conversion_dispatches` | `/app/settings/conversoes` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `channel_routing_policies` | `/app/settings/atendimento` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `channel_routing_responsibles` | `/app/settings/atendimento` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `external_db_connections` | `/app/integracao-dados` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `organization_extensions` | `/app/extensions` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `voip_trunk_settings` | `/app/settings/voip-trunk` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |
| `api_audit_log` | `/app/audit` | RLS histórica ∧ gate 0412 | membership, role e área | catálogo pg_policies |

## Portas e lacunas

| Porta | Evidência atual | Lacuna que bloqueia criação |
|---|---|---|
| UI/navigation | Sidebar, hubs, paleta e aviso usam o resolver; matriz unitária percorre 54 áreas | botões e links locais dentro das páginas ainda precisam de varredura |
| URL direta | `app/app/template.tsx` nega com 404 no servidor para área proibida | E2E autenticado de cada classe representativa pendente |
| Backend/API/actions | `requireRole` usa o mesmo resolver para recursos administrativos mapeados e role efetivo do banco | mapear rotas/actions sem `resource` e provar leitura/mutação; service role ignora RLS |
| PostgREST/RLS | 68 tabelas com gate (0410 + 0412); agentes e automações provados no Postgres descartável | recursos mistos, outras tabelas e RPCs administrativos pendentes |
| MCP | `tools/list` usa área persistida para domínios mapeados; desconhecidos são omitidos ao cliente | revisar tool a tool, domínios mistos e teste com token real |

Snapshot informativo do registry em memória, com role `agent` e scopes `mcp:read`/`mcp:write`: tenant sem preset **78** tools, perfil gerenciado **61**. Além das 14 já omitidas, `crm_list_orders`, `crm_get_order` e `crm_list_contact_orders` foram retiradas: consultam `orders` da integração Nuvemshop, classificada como não aplicável. O snapshot não substitui `tools/list` autenticado real.

As tools MCP de descoberta e preparação da integração Nuvemshop também usam a área não aplicável, inclusive para o gestor. Tools sem área auditada agora são negadas para todos os roles do tenant gerenciado; novos nomes precisam ser vinculados à área antes de aparecer no `tools/list` ou aceitar invocação direta. As actions de conectar/desconectar Nuvemshop e o callback OAuth consultam a mesma área e o membership atual antes de qualquer mutação ou troca de código por token. Duas rotas de criação/teste do agente de prospecção foram corrigidas para consultar Prospecção, não Agentes de IA.

O resumo de contato do Inbox misturava pedidos Nuvemshop (PostgREST) e enriquecimento de Prospecção (`service_role`) com dados operacionais. Agora consulta a política antes de cada seção: para tenant gerenciado com essas áreas não aplicáveis, não consulta `orders` nem `prospecting_candidates`, devolve as seções vazias e preserva o restante do painel. Teste da rota verifica resposta 200 e ausência dessas leituras. Ainda é necessário inventariar os demais recursos mistos.

As rotas de modelos dos canais parceiro e Graph parceiro separam `GET` operacional, usado pelo seletor do Inbox, de `POST` de sincronização/criação em Conexões. O upload de mídia para criar modelo continua vinculado a Conexões. O resolver de recurso e o teste de política cobrem essa divisão; E2E autenticado ainda pendente.

O indicador `GET /api/v1/ai/automatico-ativo` do Inbox não podia mais ler a tabela completa `ai_agents` com o papel de cliente. Ele agora autoriza o recurso operacional pela área Inbox e usa uma leitura interna limitada ao tenant para responder somente `{ ativo: boolean }`. O teste de rota prova 403 antes da consulta quando a área é negada e escopo explícito de `organization_id` quando permitida. A tabela completa continua protegida pela RLS.

Board de Funis, validação de dono IA no lead e nomes de agentes em Atividades deixaram de ler `ai_agents`/`ai_agent_versions` pela sessão do cliente; usam `ai_agent_assignable_directory`, que contém apenas identidade e versão pública operacional, com RLS de Funis. Isso preserva os usos necessários sem reabrir prompts ou configuração de agentes. O diretório e o isolamento por tenant têm teste Postgres; testes de resposta completos dessas três rotas ainda pendentes.

O mapa `resource → área` agora cobre os 87 identificadores literais usados por `requireRole` nas rotas `app/api/v1`. Um teste lê as rotas e falha quando surgir recurso explícito sem área canônica. Isto fecha lacunas de roteamento como `lead_captures` (Webhooks), `ai_operator_metrics` (Agentes) e `crm_stages` (Etapas do funil). A cobertura não substitui a revisão dos handlers que omitem `requireRole` nem a dos dados mistos dentro de uma área.

Bloqueio estrutural confirmado: a policy `orgs_select` ainda entrega a linha inteira de `organizations` a qualquer membro, incluindo `settings`, `ai_budget_cents`, `onboarding_state` e metadados administrativos. A aplicação usa a mesma tabela para nome/fuso/idioma do switcher e para configuração da agência; RLS de linha não separa colunas. É preciso introduzir projeção operacional segura e migrar os consumidores antes de negar a tabela completa ao cliente gerenciado. `channel_sessions` e `crm_stages` têm o mesmo problema de dados operacionais misturados com configuração. Nenhuma dessas três tabelas foi marcada como fechada.

Verificação deste lote: testes direcionados de política/rotas 80/80 e 41/41, novo indicador 2/2; `pnpm test:db tests/invariants/managed-area-rls.test.ts` 10/10 com install, reapply, cross-tenant e autoelevação negada; `pnpm typecheck` passou; `pnpm lint` terminou com zero erros e 421 avisos preexistentes. `pnpm cercas` passou 1438/1438 enquanto este lote ainda recebia alterações, logo não é usado como evidência de snapshot final.

O picker operacional `/api/v1/ai/agents/assignable` passou a ler a projeção RLS `ai_agent_assignable_directory`, com os mesmos campos de resposta e sem `service_role`. A RLS nega a tabela completa de agentes ao cliente e permite apenas o diretório necessário ao Funil.

`created_by` do token MCP não concede privilégio: num tenant gerenciado, a sessão do token consulta o membership atual do provisionador e recusa role acima dele. Isso não converte o token em cross-organization. Nenhum token é criado pelo preset.

## Testes executados

- `pnpm exec vitest run lib/managed-clients/policy.test.ts lib/mcp/managed-area-policy.test.ts …`: 74 casos, 3 arquivos, passou.
- `pnpm test:db tests/invariants/managed-area-rls.test.ts`: install + reapply do baseline em pg15 descartável e 4 invariantes, passou.
- `pnpm test:db:update`: reapply com dados sintéticos e conferência de preservação, passou.
- `pnpm exec vitest run` de auth MCP: 98 casos, 4 arquivos, passou após atualizar mocks para a nova consulta.
- Manifest, navegação, registry e switcher: 30 casos, 5 arquivos, passou.
- Typecheck: passou após aumentar heap para 4 GiB; primeira tentativa com heap padrão abortou por OOM.

**Não foram concluídos:** suíte DB integral, E2E visual, upgrade por sequência de migrations e suíte unitária integral. `pnpm lint` integral passou com 421 warnings e zero erros. Nenhuma ação de produção foi feita.

Atualização 0412: `pnpm test:db tests/invariants/managed-area-rls.test.ts` passou com install, reapply e 9 invariantes, incluindo os 58 gates e DML de automações. `app/app/template.test.tsx` cobre as 54 URLs canônicas em teste unitário de negação no servidor; E2E autenticado ainda pendente. As rotas legadas `/app/pipelines` e `/app/leads` agora são associadas a Funis.

A rota de QR `GET /api/v1/channel-sessions/[id]/qr` exigia apenas sessão e membership e expunha o pareamento de Conexões por URL direta. Agora passa por `requireRole("admin", { resource: "channel_sessions" })`; teste de rota prova 403 antes do acesso ao canal ou WAHA. O proxy também sobrescreve `x-pathname` enviado pelo navegador antes de construir a resposta encaminhada; teste valida o cabeçalho que chega aos Server Components. Duas URLs antigas de canal oficial/templates são resolvidas como Conexões e negadas no template antes do redirect.

`llm_calls` tinha isolamento por tenant da migration 0050, mas sua policy permissiva deixava qualquer membro do tenant ler Execuções pelo PostgREST. A 0412 preserva o isolamento, adiciona gate **restritivo** de Execuções e Uso, revoga `anon` e escrita de `authenticated` e concede só SELECT. O teste Postgres prova que o cliente gerenciado não lê, o gestor lê apenas seu tenant e o membro de outro tenant lê só o próprio. A rota de Uso usa a mesma tabela e permanece classificada como agência no gate HTTP.

A mesma suíte verifica no catálogo que nenhuma tabela pública com `organization_id` e grant SELECT de `authenticated` permanece sem RLS no baseline descartável. Isso é um inventário estrutural; ainda faltam políticas de área nos recursos mistos como `organizations` e `channel_sessions` e a revisão de RPCs `SECURITY DEFINER`.

`llm_calls` serve Execuções e Uso. O gate direto exige ambas as áreas para que liberar apenas uma via override futuro não exponha os dados da outra. Esse override isolado exigirá uma projeção específica para que a API correspondente continue funcional; permanece como gap de produto antes de liberar essa combinação.
