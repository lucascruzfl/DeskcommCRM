# Integração estrutural upstream v1.69.0 — alvo congelado

Base MCP: `1fb9afd535d4bdad3874166b5dd0bcfd79db3ec2`. Alvo funcional exclusivo: `v1.69.0`, commit `e8e2912178031d321caf0912b270ee06bd2c36c7`.
Base oficial para auditoria diferencial: `v1.62.0`, `f12130953174088b201f1591779f8e484eb76976`.
Nenhum código posterior ao alvo entra. Outras refs servem apenas à reserva inicial de NNNN.
Este documento não declara compatibilidade MCP 1.69 e não autoriza publicação.

## Inventário anterior ao merge

295 commits, 310 arquivos alterados e 48 arquivos sobrepostos ao overlay desde v1.62.0.
Riscos: migrations/baseline/manifest; agent engine e IA; contatos e buscas;
follow-up/classificação; LGPD e módulos opcionais; Skills; pacing/janelas;
Jev observacional; install/update e ARM64; workflows e guards docs-safe.

## Reserva canônica congelada

Fotografia: `2026-10-03T09:32:54.628832+00:00`. `migration-populacao.sh` considerou
367 refs na população local incluindo a main do produto, refs/heads e refs/remotes,
excluindo cópias mortas de PR e aliases HEAD conforme sua implementação.
`checar-colisao-de-migration.sh origin/main` atualizou a main do produto e mediu
169 outras refs não ancestrais, mais 37 PRs abertos listados e 37 medidos.
Nenhum PR listado deixou de ser buscado; nenhuma população necessária ficou NÃO MEDIDA.
Teto: **0530**, `20261002220137_0530_classificador_do_roteador_automatico.sql`,
[PR upstream #2134](https://github.com/melgarafael/DeskcommCRM/pull/2134).
Bloco **0531–0542**, congelado após a medição, sem preencher buracos.
Refs, árvores e lista de PRs estão em `INTEGRATION-1.69.0-RESERVATION.json`.
A saída inicial do gate contra main acusa colisões da história MCP antiga; não se
renumera essa história. O exit 1 não significa população incompleta.

## Prova das 12 migrations oficiais importadas

Somente o NNNN do filename mudou. Timestamp, slug e bytes SQL são oficiais.

| Timestamp upstream | NNNN upstream | NNNN fork | Slug | SHA256 upstream | SHA256 fork | Bytes iguais |
|---|---|---|---|---|---|---|
| 20260928214705 | 0485 | 0531 | lgpd_alcanca_secoes_de_modulo.sql | 86f4cce9cef1c1f06784ea5358b1ed4a7e20f8b6e010604cb5cec7a6d4bf1f12 | 86f4cce9cef1c1f06784ea5358b1ed4a7e20f8b6e010604cb5cec7a6d4bf1f12 | SIM |
| 20260929020337 | 0486 | 0532 | o_playbook_da_agenda_aprende_os_dois_passos.sql | 5d8fa2d98ea22ea82474f06d4e94235fba060825624c68757028265e7f14ed36 | 5d8fa2d98ea22ea82474f06d4e94235fba060825624c68757028265e7f14ed36 | SIM |
| 20260929053040 | 0488 | 0533 | exclusao_de_contato_sem_perder_historico.sql | b31db38741ae9c97d960a2477b6ff107b9d7d52b7997556a76a083975b0f2012 | b31db38741ae9c97d960a2477b6ff107b9d7d52b7997556a76a083975b0f2012 | SIM |
| 20260929060000 | 0489 | 0534 | followup_rls_por_operacao.sql | e9d193523b10229f383a90868e995f51564bcf821b965347276b2db0ce97a291 | e9d193523b10229f383a90868e995f51564bcf821b965347276b2db0ce97a291 | SIM |
| 20260929080000 | 0490 | 0535 | followup_trilha_e_versoes_rls_por_operacao.sql | b50db6a191c36f435e5b3e42166c32520827051720cae5a658f2f651f0e00919 | b50db6a191c36f435e5b3e42166c32520827051720cae5a658f2f651f0e00919 | SIM |
| 20260929115848 | 0491 | 0536 | dedupe_de_event_dead_atomico.sql | 9a22129db28fa05c53d94fa74a920c97161da096ffb01b493021bb7aeafb776a | 9a22129db28fa05c53d94fa74a920c97161da096ffb01b493021bb7aeafb776a | SIM |
| 20260930010300 | 0494 | 0537 | lgpd_cascata_banco_alcanca_notas_itens.sql | b89e53e7daf6d1b24d5164ec1d37a42b99163124f8a10312699b19e414545d03 | b89e53e7daf6d1b24d5164ec1d37a42b99163124f8a10312699b19e414545d03 | SIM |
| 20260930120000 | 0495 | 0538 | janela_de_resposta_separada.sql | bbc909039b227130ea84d6e33ccd27cc60af7047bb6a7e6b33a87df17eda19df | bbc909039b227130ea84d6e33ccd27cc60af7047bb6a7e6b33a87df17eda19df | SIM |
| 20260930140000 | 0497 | 0539 | lgpd_anonimizar_apaga_transcricao.sql | 8fa816d77a92a273e3610e18c0a7c90357953420e552c00f53411cf9ffdf5800 | 8fa816d77a92a273e3610e18c0a7c90357953420e552c00f53411cf9ffdf5800 | SIM |
| 20260930150000 | 0498 | 0540 | debounce_rajada_configuravel.sql | 6b6ee3c464f771d3db21f97769692f167d951ecf0c25d285e53ce8fc95c55029 | 6b6ee3c464f771d3db21f97769692f167d951ecf0c25d285e53ce8fc95c55029 | SIM |
| 20260930160000 | 0499 | 0541 | atraso_humano_por_conexao.sql | aaed49fc9027df00547e995b32dca66e4ada1c7f8f7ff749c0a9029aa0e9f790 | aaed49fc9027df00547e995b32dca66e4ada1c7f8f7ff749c0a9029aa0e9f790 | SIM |
| 20260930170000 | 0500 | 0542 | avisos_do_jev_na_central.sql | cee866b414ea34288bf0e52892c3df25baec01cb92e96842b03af1a809a75d5f | cee866b414ea34288bf0e52892c3df25baec01cb92e96842b03af1a809a75d5f | SIM |

427 identidades canônicas, sem NNNN ou timestamp repetido; uma migration legada
`00001_initial_schema.sql` permanece como na base. Todas as 416 migrations SQL da
base permanecem byte-a-byte intactas. A ordenação é pelo timestamp: a oficial
`20260928214705_0531_...` continua antes do preset managed `20260928220000_0485_...`.

## Conflitos: A = base comum, B = upstream, C = overlay

| Arquivo | Semântica B + C aplicada |
|---|---|
| app/api/v1/contacts/_handler.ts | B: piso e normalização de busca; exclusão em RPC atômica com rollback. C: actor e proveniência de token, organização explícita e auditoria mantidos. DELETE continua ação humana; sem tool nova. |
| docs/testing/user-journey-map.md | Jornada J38 upstream e jornada managed clínica/ISP preservadas. |
| lib/auth/types.ts | Moeda/país upstream coexistem com managed_policy. |
| lib/database.types.ts | União estrutural gerada dos tipos da base e dos dois lados; todos os membros e novos campos preservados. Opcionalidade de channel_session_id no Insert do fork permanece. |
| package.json | União dos gates test:shell, incluindo merge guards, módulos opcionais, MCP e runtime do agente. |
| supabase/baseline.sql | Blocos upstream e managed coexistem. Seed do playbook upstream é fechado antes dos presets managed. Cabeçalho deslocado da varredura removido; scan real continua único e final. Última provisionadora Honorários preserva gates managed e forma upstream segura para updates antigos. |
| tests/e2e/helpers/agenda-semana-integra.ts | Navegação multi-mês do fork espera mudança de mês e, no chamador, o próprio critério de dias futuros upstream; não devolve horários de frame transitório. |
| tests/shell/guarda-arm-so-considera-instalacao-real.test.sh | PATH sem Docker realmente isolado do fork; cenário sem imagem usa riscv64 porque upstream passou a suportar ARM64. |
| tests/unit/contato-delete.test.ts | Expectativas de transação única, organização e rollback, sem DELETEs parciais. |
| tests/unit/imagens-ok-so-aceita-pulo-declarado.test.ts | Docs-safe comprovado coexistindo com manifesto multiarch; manifesto inválido reprova também no fast path. |
| tests/unit/memoria-da-org-origem-cabe-no-check.test.ts | Origem manual/ternária do fork e detecção de origem dinâmica preservadas; caminhos Windows normalizados e controle upstream mantido. |

Não houve escolha ours/theirs em massa. Automerges dos 48 caminhos sobrepostos
continuam sujeitos aos gates dirigidos. Ajustes adicionais de testes: referência
Jev aponta para o mesmo SQL renumerado; ADR localiza LGPD pelo timestamp e mede todas
as redefinições da provisionadora (última é efetiva); marcador LGPD acompanha o novo
NNNN. Nenhum teste de tenant isolation foi removido. O automerge de auth-falha-alto
criou dois mocks concorrentes do mesmo cliente; um mock por tabela reúne memberships,
organização do suporte e managed policy, preservando todas as asserções. O teste de
dedupe event_dead passa a referenciar 0536. O catálogo RPC foi efetivamente revisado,
não relaxado para aceitar funções desconhecidas.

## Checklist de arquitetura

Integração, sem peça de produto inventada: fontes são os dois pais; consumidores
reais permanecem nas rotas, engine e tools existentes. Logs continuam em audit,
api_audit_log, event_log e atividades. Portas/telas, next steps de follow-up,
continuidade IA↔humano e configurações upstream/managed foram preservados.
Nenhuma nova decisão humana foi delegada. Mapas existentes dos dois lados foram
mantidos; nenhuma aresta artificial foi criada.

## Validação

- `git diff --check` e `git diff --cached --check`: verdes; nenhum conflito restante.
- Regra canônica extraída do job de invariantes, aplicada à árvore candidata:
  428 SQL, nenhum NNNN ou timestamp duplicado. 416 SQL históricos intactos.
- MANIFEST: as 12 identidades timestamp/NNNN/slug correspondem exatamente aos filenames finais.
- Baseline: instalação limpa e reaplicação com ON_ERROR_STOP=1 verdes em PG15/PG17.
- `NODE_OPTIONS=--max-old-space-size=6144 pnpm typecheck`: verde, incluindo rechecagem final.
- `pnpm lint`, `pnpm lint:channels`, `pnpm lint:role-rank`: verdes (channels mantém 62 dívidas existentes).
- Aplicação/MCP: 168 arquivos dirigidos, 2671 testes; 7 falhas iniciais em dois
  arquivos corrigidas (mock admin duplicado e referência 0491 no MANIFEST). Os 14
  testes desses dois arquivos passaram na rechecagem; os demais 166 arquivos
  passaram na rodada original. Um expected fail existente, nenhum teste removido.
- Banco dirigido: 45 arquivos, 458 testes em cada major; a única falha inicial
  era o catálogo RPC v1.62 desatualizado. Cinco funções novas e quatro redefinidas
  revisadas: nenhum ACL antigo mudou; catálogo de 277 funções atualizado sem mudar
  a invariante. Rechecagem RPC, contato atômico e Jev: 3 arquivos/14 testes verdes
  em PG15 e PG17; os outros 44 arquivos já haviam passado em cada major.
- Shell: os 34 comandos canônicos de test:shell passaram. Uma falha transitória no
  teste degraded do instalador passou na reexecução inteira dos validadores, sem
  mudança de código; os 32 gates seguintes foram executados e passaram.
- Upgrade real: `TEST_DB_INSTALL_BASELINE=<baseline extraído de 1fb9afd...>
  pnpm test:db:update`, com pgvector/pgvector:pg15 e pg17. Install da base anterior,
  10 linhas semeadas, update candidato sobre dados e nova reaplicação verdes;
  dados preservados, 8 objetos com identidade estável e view antiga migrando.
  Apenas containers efêmeros do harness canônico, nenhum banco operacional.

A auditoria MCP diferencial é a próxima fase, somente depois do merge local.
RELEASE-AUDIT.json permanece byte-a-byte igual à base (compatibilidade declarada
somente para 1.57.0, não para 1.62/1.69).

### Exceção explícita do hook, somente neste merge

O script real `.agents/skills/deskcomm-contribuir/scripts/hooks/check-migration-triple.sh`
foi executado sem exceção. A primeira execução foi interrompida por custo do locale
UTF-8 na população extensa; a reexecução do mesmo script com `LC_ALL=C` terminou
com exatamente **12 bloqueios de timestamp**, sem bloqueio de NNNN ou outro motivo.
As 240 cópias desses timestamps nas refs consideradas foram comparadas com o
commit alvo: todas são a mesma migration oficial, com SHA256 e bytes idênticos.
Dentro da candidata, os timestamps são únicos.

O próprio script documenta: `Bypass explícito (correção orientada pelo mantenedor):
DESKCOMM_MIGRATION_EDIT=1`. A orientação explícita desta integração exige manter
identidade upstream e autoriza essa exceção somente neste caso comprovado.
O merge usa `DESKCOMM_MIGRATION_EDIT=1 git commit -m "merge: integrar upstream v1.69.0"`.
Não há --no-verify, hooks globalmente desativados, alteração de guards ou alteração
nos timestamps/bytes SQL. Nenhuma outra exceção é necessária.

## Arquivos sobrepostos inventariados

- `.github/workflows/ci.yml`
- `.github/workflows/e2e.yml`
- `.github/workflows/publish-image.yml`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `app/api/v1/ai/agents/assignable/route.ts`
- `app/api/v1/ai/pacing/route.ts`
- `app/api/v1/contacts/_handler.ts`
- `app/api/v1/contacts/import/route.test.ts`
- `app/api/v1/system/version/route.test.ts`
- `app/app/agenda/page.tsx`
- `app/app/ai/agents/[id]/_components/AgentForm.tsx`
- `app/app/settings/atualizacao/_components/UpdatePanel.test.tsx`
- `app/app/settings/atualizacao/_components/UpdatePanel.tsx`
- `components/connections/AntiBanSheet.tsx`
- `components/kanban/EditLeadDialog.tsx`
- `components/kanban/LeadFieldsForm.tsx`
- `components/kanban/NewLeadDialog.tsx`
- `docs/index.md`
- `docs/testing/user-journey-map.md`
- `hostgator-setup-kit/_common.sh`
- `hostgator-setup-kit/install.sh`
- `hostgator-setup-kit/test-validators.sh`
- `hostgator-setup-kit/update.sh`
- `lib/ai/inbox-destino.test.ts`
- `lib/ai/inbox-destino.ts`
- `lib/auth/server.ts`
- `lib/auth/types.ts`
- `lib/database.types.ts`
- `lib/i18n/dicionario.ts`
- `lib/legal/perfil-do-pais.ts`
- `lib/prospecting/agent-setup.ts`
- `package.json`
- `scripts/test-update-com-dados.sh`
- `supabase/baseline.sql`
- `supabase/migrations/MANIFEST.md`
- `tests/e2e/agenda-presenca-recuperacao.spec.ts`
- `tests/e2e/helpers/agenda-semana-integra.ts`
- `tests/invariants/rbac-config-ia-canais.test.ts`
- `tests/shell/guarda-arm-so-considera-instalacao-real.test.sh`
- `tests/unit/auth-falha-alto.test.ts`
- `tests/unit/contato-delete.test.ts`
- `tests/unit/funil-filtro-de-tag-le-as-duas-caixas.test.ts`
- `tests/unit/gatilho-dos-jobs-de-entrega.test.ts`
- `tests/unit/imagens-ok-so-aceita-pulo-declarado.test.ts`
- `tests/unit/memoria-da-org-origem-cabe-no-check.test.ts`
- `tests/unit/protecao-de-envio-aceita-data-em-branco.test.ts`
