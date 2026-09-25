# Fase 2 — estado medido da autorização gerenciada

Base `mcp/stable` `0a7511a886f12f5f699bac2aceedf957d179a3d3`; trabalho sobre `457bcfa9dece532784bef225797cda8535f17a1d`.

**Onboarding real permanece bloqueado.** A migration 0410 cria `managed_client_policies` sem backfill; nenhum tenant existente recebe preset. A linha guarda tipo de negócio, modo, preset, versão, snapshot das áreas, overrides, autor e data. O snapshot é produzido por `buildManagedAreaPolicy()` a partir do catálogo tipado de 54 áreas. UI e MCP leem a mesma linha. O banco lê a mesma coluna `areas` em `fn_managed_area_allowed`. `can_execute` continua falso porque não há cobertura completa das rotas, actions, tabelas e RPCs.

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
| `api_tokens` | API Tokens | admin tenant | gate restritivo de API Tokens | baseline install/reapply; DML específico pendente |
| `managed_client_policies` | Política | inexistente | SELECT de membro; mutação só `service_role` após gate da aplicação | Postgres real: `authenticated` não tem UPDATE; isolamento de SELECT |
| `ai_agent_assignable_directory` | Funis (picker operacional) | inexistente | projeção mínima RLS por membership + área Funis; trigger a mantém | Postgres real: agent 1 linha; sem prompt/credencial; versão sincronizada |
| Demais tabelas das 29 áreas | Conforme catálogo | diversas | mapear e provar gate por área antes de habilitar criação | **PENDENTE** |
| RPCs administrativos | Conforme função | diversas | rever EXECUTE e autorização interna por membership/área | **PENDENTE** |

As policies novas são `AS RESTRICTIVE FOR ALL`: compõem por AND com as policies permissivas históricas. A migration não transforma uma policy de escrita em SELECT por OR.

## Portas e lacunas

| Porta | Evidência atual | Lacuna que bloqueia criação |
|---|---|---|
| UI/navigation | Sidebar, hubs, paleta e aviso usam o resolver; matriz unitária percorre 54 áreas | botões e links locais dentro das páginas ainda precisam de varredura |
| URL direta | `app/app/template.tsx` nega com 404 no servidor para área proibida | E2E autenticado de cada classe representativa pendente |
| Backend/API/actions | `requireRole` usa o mesmo resolver para recursos administrativos mapeados e role efetivo do banco | mapear rotas/actions sem `resource` e provar leitura/mutação; service role ignora RLS |
| PostgREST/RLS | 9 tabelas com gate; `ai_agents` e versões provadas no Postgres descartável | demais tabelas e RPCs administrativos pendentes |
| MCP | `tools/list` usa área persistida para domínios mapeados; desconhecidos são omitidos ao cliente | revisar tool a tool, domínios mistos e teste com token real |

Snapshot informativo do registry em memória, com role `agent` e scopes `mcp:read`/`mcp:write`: tenant sem preset **78** tools, perfil gerenciado **64**. As 14 omitidas são `crm_list_managed_client_presets`, `crm_preflight_managed_client`, `crm_list_ai_skill_versions`, `crm_search_knowledge`, `crm_list_knowledge_sources`, `crm_list_improvement_proposals`, `crm_get_org_memory`, `crm_describe_external_data`, `crm_query_external_data`, `crm_list_webhook_sources`, `crm_list_webhook_source_events`, `crm_list_automation_rules`, `crm_list_automation_runs`, `crm_list_followups`. O snapshot não substitui `tools/list` autenticado real.

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
