# Integração da linha MCP com upstream v1.62.0

## Âncoras e escopo

- Origem MCP: `7c9702dda36cb19f33996f625471b1a07fb27b61`, com base publicada `v1.57.0-mcp` (`10b15555fcdfdd499279e44b1adef2845f8ff89f`).
- Primeiro merge oficial: tag local `upstream-v1.61.0` → `61077371bcdae27ecb4dc1583bad927ea25a2e02`; merge intermediário `3ca5f445aac8672788eda1c7d6e234613f7aeb38`.
- Alvo final, na mesma branch e PR: tag local `upstream-v1.62.0` → `f12130953174088b201f1591779f8e484eb76976`. A tag foi buscada de `melgarafael/DeskcommCRM` e teve o commit conferido antes do merge.
- Destino futuro da PR: `mcp/stable`. Produção, release, tag e imagens MCP continuam em `v1.57.0-mcp`; `docs/mcp/RELEASE-AUDIT.json` não foi atualizado. Esta integração não declara compatibilidade nem prepara `mcp-release.json` para 1.62.

## Migrations e identidade

A população foi medida com `scripts/checar-colisao-de-migration.sh origin/main`: main oficial, 80 refs e 12 PRs abertos. O próximo NNNN livre medido antes da renumeração foi 0486. As managed 0458–0475, distribuídas na v1.57.0-mcp com timestamps `20260927201500`–`20260927201517`, permanecem com nomes e bytes históricos. O ISP 0485 (`20260928220000`) ainda não foi distribuído e permaneceu livre. Nenhum timestamp da faixa oficial 0462–0475 coincidia com os timestamps managed.

Novas oficiais desde a v1.57.0: 0443, 0444, 0448, 0449, 0462–0478, 0480–0484 (26 arquivos). A ordem de execução é por timestamp. As oficiais 0462–0475 receberam somente novo NNNN, preservando timestamp e SQL executável. A exceção de colisão do checker exige o hash dos bytes managed publicados e a igualdade de bytes entre o arquivo oficial de `origin/main` e o integrado.

| Oficial | MCP | Timestamp preservado | Tema |
| --- | --- | --- | --- |
| 0462 | 0486 | `20260928140000` | configuração de propostas |
| 0463 | 0487 | `20260928140100` | IA de rascunho |
| 0464 | 0488 | `20260928140200` | proposta comercial |
| 0465 | 0489 | `20260928140300` | organização da proposta |
| 0466 | 0490 | `20260928140400` | numeração e envio |
| 0467 | 0491 | `20260928140500` | preço e rascunho único |
| 0468 | 0492 | `20260928140600` | referência de modelo |
| 0469 | 0493 | `20260928140700` | revisão e auditoria |
| 0470 | 0494 | `20260928140800` | follow-up e orçamento |
| 0471 | 0495 | `20260928140900` | tabela de modelos |
| 0472 | 0496 | `20260928141000` | briefing e revisão |
| 0473 | 0497 | `20260928141100` | seções editadas |
| 0474 | 0498 | `20260928141200` | sugestão de modelo |
| 0475 | 0499 | `20260928141300` | proposta pronta para revisão |

As oficiais 0483 (`20260928184045`, anexo interno) e 0484 (`20260928200400`, busca humana) mantêm nome, timestamp e SQL. A 0482 oficial foi a única adaptação de SQL: `DROP` + `CREATE` de `comando_da_conversa(conversations)` falhava porque a view `operational_conversations` já distribuída depende da função. `CREATE OR REPLACE` mantém a mesma assinatura, corpo oficial, ACL reafirmada e dependência da view. A mesma adaptação está no baseline. A nova migration MCP 0500 (`20260928232803`) fecha RLS de Empresas/Pessoas, importação, propostas e Honorários para managed clients e mantém Honorários protegido quando o módulo é instalado depois. Ela é posterior por timestamp ao ISP 0485. MANIFEST e baseline refletem a cadeia.

## Reconciliação de produto e segurança

- O baseline reúne as mudanças oficiais 1.58→1.62 e os apêndices managed; a varredura final de grants anon/authenticated continua após as novas funções. INSTALL e UPDATE idempotentes foram medidos em banco efêmero.
- As novas áreas Empresas, Pessoas, Importação, Propostas, modelos e Honorários ficaram `not_applicable` em clínica e ISP, pois os módulos são opcionais e nenhum preset requer esses recursos. `/app/settings/recursos` ficou explicitamente `agency` nos dois presets: oferece caminhos para configurar a organização. Nenhuma área nova vira `client` automaticamente. Ferramentas MCP de propostas e Honorários têm mapeamento explícito para as mesmas áreas; o registry continua fail-closed para tool sem área.
- O MCP Full Control, `platform_admin full` como único criador de managed client, membership oficial e organization switcher permanecem. Não foi introduzido impersonation nem token cross-tenant. A rota MCP de conhecimento mantém área de agência; a busca humana nova usa sessão, `organization_id` da autorização, rate limit por pessoa e organização e telemetria separada do agente.
- O anexo da nota usa `internal-media`, URL assinada por 60 segundos, limpeza e LGPD oficiais. O upload foi alinhado à rota de criação da nota: sessão humana e `operational_conversations` sob a política de visibilidade antes de gravar no Storage. O path é validado contra `..`, `.`, segmento vazio e barra invertida. Não existe caminho que o envie pelo adaptador WhatsApp.
- A correção upstream de escrita de negócio exige o contato do turno ou seu fallback seguro. Os filtros E/OU de tags chegam a Inbox, Funil e Contatos; a tool MCP de conversa continua sem filtro de tag e passa `tag`/`modo` explicitamente como `undefined` ao schema, preservando seu contrato.
- O conteúdo upstream de advocacia na skill convive com managed clients, ISP, calendário OFF e billing/PIX dependente de integração real. `.claude/skills` é espelho gerado por `pnpm skills:sync`, não edição independente.
- O canal `custom-mcp` do instalador/atualizador continua fail-closed; os scripts oficiais compatíveis foram integrados. Recursos opcionais permanecem desligados no ISP, sem implementação da etapa 7B.

## Validação e limites

- `pnpm vitest run` dirigido: managed presets/policy, MCP auth/registry, mídia, negócio do contato, multi-tag, notas, recursos opcionais e telemetria — 11 arquivos / 286 testes passaram.
- `pnpm test:db` dirigido: baseline INSTALL/UPDATE, RLS de módulos opcionais, área managed, anexo/LGPD, visibilidade de nota e cadeia managed — 5 arquivos / 32 testes passaram em PostgreSQL 15.
- Salto com dados: `TEST_DB_INSTALL_BASELINE` apontou ao `baseline.sql` extraído da tag `v1.57.0-mcp`; `pnpm test:db:update` passou em `pgvector/pgvector:pg15` e `:pg17`. Dez linhas semeadas sobreviveram; oito objetos mantiveram identidade; a view de ocupação conservou OID. Nenhuma conexão de teste apontou à produção.
- Cadeia Supabase: baseline da tag `v1.57.0-mcp` seguido dos 28 arquivos adicionados desde essa tag, ordenados por timestamp e aplicados individualmente com `ON_ERROR_STOP=1`, passou em PostgreSQL 15 e 17. A árvore final tem 415 migrations, sem NNNN ou timestamp duplicado. Os hashes dos arquivos oficiais 0483/0484 são idênticos aos da tag v1.62.0.
- `pnpm skills:sync`: espelho fiel para todas as skills.
- `pnpm test:shell`: passou, incluindo instalador, update e canal MCP fail-closed. `pnpm lint:channels`, `pnpm lint:role-rank`, teste de MANIFEST/baseline e `git diff --check`: passaram. O checker contra `origin/main`, refs e PRs abertos aceitou apenas as 14 colisões históricas cujos hashes publicados e oficiais coincidem, e apontou 0501 como próximo NNNN livre. A main avançou além da tag; o checker declarou essa diferença sem reprovar.
- A primeira rodada do CI revelou trechos duplicados em `lib/database.types.ts` do merge; o arquivo foi regenerado com Supabase CLI a partir do baseline integrado aplicado em PostgreSQL descartável. O inventário `managed-client-rpc-audit.json` foi refeito com os hashes reais de 272 funções e revisão das 12 assinaturas novas e sete corpos alterados. A varredura final de permissões volta a ter um único cabeçalho no fim do baseline. A spec E2E duplicada entre as partes 5 e 6 ficou somente na parte 6. Quatro testes de mensagens passaram a usar o dublê compartilhado com as projeções managed; 97 casos dirigidos passaram após a correção. Os três invariantes dirigidos de RPCs, definer/anon e tipos gerados passaram em PostgreSQL 15.
- O typecheck integral esgotou o heap padrão de Node na VPS durante a integração intermediária. A tentativa com heap de 3 GiB foi interrompida quando a memória disponível da VPS caiu abaixo de 600 MiB; o resultado integral será medido novamente pelo check `verify` do Actions, junto de build e E2E completo. Não houve merge da PR, tag, release ou deploy.
