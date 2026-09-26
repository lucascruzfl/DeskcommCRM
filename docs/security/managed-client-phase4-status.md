# Clínica gerenciada: superfícies mistas (fase 4)

Estado da árvore em 2026-09-25. Este documento registra o recorte da fase 4;
**não certifica** UI, URL direta, token MCP persistido nem E2E autenticado.

| Tabela             | A: operação do cliente                                                                                                | B: administração                                                                           | C: interno/sensível                                                                                           | D: legado                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `organizations`    | `id`, `slug`, `display_name`, `timezone`, `locale`, `currency`, `country`, `status` e chaves permitidas de `settings` | nome legal, CNPJ, retenção, DPO, privacidade, interface e configuração de marca/roteamento | `onboarding_state`, `created_by`, orçamento, rate limit, suspensão, `settings` não projetado, campos técnicos | nenhum campo confirmado sem uso |
| `channel_sessions` | `id`, `organization_id`, nome de exibição, telefone, status, provider, arquivo e criação                              | warmup, limites, saúde, conexão e status administrativo                                    | sessão WAHA, tokens, segredo cifrado, metadata interna e referências do provedor                              | nenhum campo confirmado sem uso |
| `crm_stages`       | `id`, org, funil, nome, slug, descrição, posição, cor, ganho/perda, arquivo, necessidade humana e duração prevista    | autoria, hint de agente e configuração da etapa                                            | timestamps técnicos e metadata de mudança                                                                     | nenhum campo confirmado sem uso |

As views `operational_organizations`, `operational_channel_sessions` e
`operational_crm_stages` são projeções explícitas. SELECT direto nas três bases
é restringido pela classificação persistida da área administrativa. O teste
`managed-postgrest-jwt.test.ts` usa um PostgREST descartável com JWT assinado e
prova base negada ao cliente, projeção própria, tenant alheio vazio, gestor com
membership e chamada direta de RPC administrativa negada.

Consumidores operacionais migrados incluem Inbox/seletor de canais, Funil/lead,
tags/agenda, serviço de conversas, leitura MCP de etapas/funil e tool de troca
de canal. Consultas administrativas que usam `service_role` continuam na base
com `organization_id` explícito. A busca textual de referências ainda inclui
ações administrativas, jobs e serviços internos; a classificação de **cada**
chamada e a certificação de retorno de todos os handlers permanecem pendentes.

RPCs do recorte: `fn_set_channel_routing`, `fn_reserve_channel_connection` e
`fn_definir_aviso_de_caso` receberam gate da policy canônica antes da escrita;
`fn_colegas_podem_mexer_na_agenda` recebeu membership check; o vocabulário de
tags e as métricas de etapas leem projeção. A revisão de todas as RPCs das 54
áreas permanece pendente. Não declarar `RPC: PASS` ainda.

O preflight continua `can_execute=false`, o preset `executable=false`, e não
existe tool de criação. Não executar onboarding até UI, URL, API/actions,
PostgREST/RLS, MCP com token persistido e E2E autenticado passarem juntos.

## Avanço da fase 5 (ainda sem certificação)

`crm_pipelines.settings` deixou de ser legível pela linha base para o cliente
gerenciado. A migration 0419 restringe o SELECT da base e publica
`operational_crm_pipelines` com colunas de operação, vocabulário e somente as
chaves de `settings` usadas para desenhar campos e validar motivos de perda.
Cada campo e opção é projetado por allowlist; chaves internas aninhadas não
atravessam a view. UI do Funil, resumo de CRM do Inbox, rotas operacionais e
tools MCP de leitura foram migrados. O teste com JWT real no PostgREST cobre
base negada, projeção própria, tenant alheio e ausência de chaves internas.

O mesmo teste passou a persistir um token MCP sintético no Postgres descartável
e chamar o handler real: `initialize`, `tools/list`, três chamadas proibidas,
uma chamada operacional permitida e uma leitura cross-tenant recusada. O token
plaintext nunca é impresso. Isso mede o MCP neste recorte, não a UI.

A auditoria de rotas encontrou GET de catálogo em
`/api/v1/ai/providers/[provider]/models` acessível a qualquer membro; agora
passa pelo guard da área administrativa. A busca por colunas técnicas nas
tabelas tenant-aware geradas apontou outras tabelas mistas para revisão, entre
elas `calendar_connections`, `messages`, `conversations` e
`user_organizations`. Ainda não há matriz de RLS/consumidores concluída para
elas, nem inventário fechado de RPCs e API/actions das 54 áreas.

O papel `agent` não cumpre hoje toda a classificação `shared`: a página
`/app/settings/tags` redireciona esse papel para `/403`, embora o preset a
classifique como compartilhada. Não mudar o papel ou afrouxar a página sem
decidir a capability de gestão de tags. UI autenticada, URL direta e jornadas
cliente/gestor/cross-tenant exigem stack local completo e continuam sem prova.
Nenhum service de onboarding foi criado; `can_execute` segue `false`.

## Retomada da fase 5 em 2026-09-26

A árvore já continha as migrations 0414–0421. A 0421 estava interrompida:
faltavam o apêndice do `baseline.sql`, a linha no `MANIFEST.md` e os leitores
da Agenda nas projeções. Esses três pontos foram completados. A página
`/app/agenda`, o GET de calendários Google e a atualização do catálogo leem
`operational_calendar_connections` ou
`operational_calendar_connection_calendars`; callback, desconexão e workers
continuam nas bases com `service_role` e escopo de organização. Nenhuma
migration posterior foi criada.

O baseline passou em instalação nova e reaplicação estrita. `pnpm test:db`
terminou com 270 arquivos aprovados, 2.282 casos aprovados, uma falha esperada
e um skip. O teste HTTP com JWT de `managed-postgrest-jwt.test.ts` passou em 13
casos, inclusive a base dos calendários negada para o cliente gerenciado, a
projeção própria, o tenant alheio vazio e os tokens/cursores ausentes. O teste
unitário da rota de calendários verifica o retorno sem `sync_cursor`,
`sync_token` ou token OAuth. Typecheck passou com heap Node de 4 GB; lint saiu
com zero erros e 421 avisos. `lint:channels`, `lint:role-rank` e
`release:conferir` passaram.

Ainda **não há certificação**. O inventário dos consumidores das 54 áreas,
RPCs, APIs e actions não foi fechado. `conversations` e `messages` ainda contêm
`metadata` arbitrário na linha base, com RLS de leitura para o atendimento; o
handler de listagem de conversas também seleciona `metadata`. A classificação
dos campos, dos consumidores e dos retornos precisa ser concluída antes de
afirmar zero leaks. A divergência de `agent` em `/app/settings/tags` permanece.
`lib/database.types.ts` contém as primeiras três views operacionais, mas
ainda não foi regenerado para as views de funil e calendários; este arquivo
gerado não deve ser corrigido à mão.
Para retomar o inventário dos leitores das seis tabelas mistas, executar
`rg -l '\.from\("(organizations|channel_sessions|crm_stages|crm_pipelines|calendar_connections|calendar_connection_calendars)"\)' app lib workers --glob '*.ts' --glob '*.tsx' --glob '!*.test.ts' --glob '!*.test.tsx'` e classificar cada consulta por papel, área, client de sessão ou service role e campo retornado. O resultado desta busca ainda não é uma autorização.
Quatro rotas de propostas de contato e reativação de lead passaram a informar
`contacts` ou `crm_leads` ao `requireRole()`, para que overrides da área também
valham nessas APIs. Um teste de inventário agora rejeita rotas de tenant que
chamem `requireRole()` sem recurso de área.
Após esses ajustes, `pnpm typecheck` e `pnpm test:shell` passaram; o teste
direcionado da policy passou em 64 casos.
`pnpm test:db:update` passou em PostgreSQL 15 e 17, reaplicando o baseline
sobre dados sem alterar a identidade dos objetos monitorados.
Faltam prova de UI autenticada, URL direta, E2E cliente, gestor e cross-tenant;
o teste MCP persistido cobre o recorte de tools e não substitui essas jornadas.
A árvore não contém `.env.e2e` nem o CLI Supabase instalado. O helper local
`scripts/local-supabase.sh` move `supabase/migrations` durante o start, então
não foi executado sobre esta árvore com migrations novas não commitadas. A
instalação já ativa no host não foi usada como bancada de teste.
A branch local está 281 commits atrás de `origin/main`, com 29 arquivos
modificados aqui também alterados lá; nenhuma integração foi tentada na árvore
suja. `can_execute=false`, `executable=false`, sem service de onboarding, sem
tenant real, convite, token de produção, deploy ou alteração em produção.

O erro de `pdf-extractor.test.ts` citado na passagem de fase é reproduzível
quando o arquivo de teste Vitest é importado pelo CLI `tsx`: o próprio Vitest
recusa ser carregado como CommonJS. O comando correto `vitest run` passou o
arquivo; ambos os arquivos (`pdf-extractor.test.ts` e o `it.fails` da agenda)
estão idênticos aos da `origin/main`. A falha esperada da agenda continua sendo
“o compromisso EM ANDAMENTO ainda é Próximos — começou, mas não terminou”:
o teste registra que uma consulta em curso cai em “Passados” antes de terminar.
