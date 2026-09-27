# Fase 6 — integração do upstream v1.57.0

Destino: infraestrutura. Integração da release oficial e reorganização das migrations managed ainda não distribuídas; sem corte de release, deploy ou merge do PR #20. A operação comum permanece com os contratos upstream.

## Âncora oficial

- HEAD de partida: `24dc58b8fff7fa16d2b5c9532f8729a07dec8130`.
- Remoto oficial: `origin` → `melgarafael/DeskcommCRM`.
- Tag anotada `v1.57.0`: objeto `dd2a8663a8607e6aaa95af2c8ebfc53e4762d21c`.
- Commit da tag: `6206bca728a3762f42add7c5773a3a39c4c35abc`, confirmado por `git ls-remote --tags origin 'refs/tags/v1.57.0*'` e pela release oficial no GitHub.
- Integração por merge desse commit exato, preservando o HEAD certificado como primeiro pai; nenhum número de versão criado nesta etapa.

## Colisões e ordem

O upstream oficial ocupa 0440 (`etapa_avisa_na_central`), 0441 (`sons_dos_avisos`) e 0442 (`aviso_da_central_no_barramento`). Todas as três colidiam com migrations managed diferentes. A checagem antes da renumeração mediu main oficial, refs locais/remotas e os 15 PRs upstream abertos na rodada; próximo número livre: 0458.

A ordem de dependências é a ordem de aplicação por timestamp da branch certificada: as antigas 0454/0455 criam a política e o diretório antes das antigas 0440–0453. Não se ordenou o bloco pelo número antigo. O bloco completo agora tem números e timestamps crescentes, posterior às três migrations oficiais. Como as migrations managed não foram distribuídas, seus timestamps também foram substituídos. O SQL executável das 18 migrations continua idêntico; apenas nomes e comentários de referência mudaram.

| Antes | Depois | Migration |
| --- | --- | --- |
| `0454` / `20260927015100` | `0458` / `20260927201500` | `politica_de_area_gerenciada` |
| `0455` / `20260927015101` | `0459` / `20260927201501` | `diretorio_seguro_de_agentes_atribuiveis` |
| `0440` / `20260927015103` | `0460` / `20260927201502` | `areas_administrativas_no_postgrest` |
| `0441` / `20260927015104` | `0461` / `20260927201503` | `escrita_administrativa_de_funis_e_canais` |
| `0442` / `20260927015105` | `0462` / `20260927201504` | `projecoes_operacionais_gerenciadas` |
| `0443` / `20260927015106` | `0463` / `20260927201505` | `leitura_base_administrativa_gerenciada` |
| `0444` / `20260927015107` | `0464` / `20260927201506` | `rpc_administrativas_respeitam_policy` |
| `0445` / `20260927015108` | `0465` / `20260927201507` | `rpc_operacionais_leem_projecao` |
| `0446` / `20260927015109` | `0466` / `20260927201508` | `rpc_de_leitura_sem_base` |
| `0447` / `20260927015110` | `0467` / `20260927201509` | `funil_operacional_sem_configuracao` |
| `0448` / `20260927015111` | `0468` / `20260927201510` | `projecoes_para_triggers_e_tipos` |
| `0449` / `20260927015112` | `0469` / `20260927201511` | `calendarios_operacionais_sem_tokens` |
| `0450` / `20260927015113` | `0470` / `20260927201512` | `rpc_respeitam_areas_gerenciadas` |
| `0451` / `20260927015114` | `0471` / `20260927201513` | `inbox_operacional_sem_metadados_privados` |
| `0452` / `20260927021800` | `0472` / `20260927201514` | `reconciliar_rpc_managed_com_153` |
| `0453` / `20260927022600` | `0473` / `20260927201515` | `autoria_operacional_de_mensagem_153` |
| `0456` / `20260927125100` | `0474` / `20260927201516` | `onboarding_cliente_gerenciado` |
| `0457` / `20260927133000` | `0475` / `20260927201517` | `aviso_de_caso_conciliar_areas_e_arquivamento` |

MANIFEST, rótulos do baseline, provas de upgrade/RLS e demais referências aos arquivos acompanham os novos nomes. A exceção histórica já declarada no checker (0382 MCP, link oficial 0385 com timestamp/bytes oficiais) permanece; não se reescreveu migration distribuída. Não há duplicidade de NNNN ou timestamp na árvore resultante.

## Reconciliação e autorização

- `supabase/baseline.sql`: preservados todos os objetos/portões managed e incorporados os três blocos oficiais; a varredura final de anon e as travas de suporte continuam depois de toda criação de função/tabela.
- `package.json`: mantidos os comandos locais do fork, inclusive `test:responsive`; comandos de worker/crons/judge adotam `--env-file-if-exists` oficial.
- `docs/testing/user-journey-map.md`: preservadas as jornadas dos dois lados.
- `tests/unit/messages-handler-silencio-ia-apos-humano.test.ts`: mantidos os dublês das projeções managed e a nova prova upstream de fronteira vencida, antes do aviso vigente.
- `settings_sons`, recurso da nova rota upstream, segue `/app/settings/notifications` e o snapshot/override de área já existente; o RBAC original da rota continua obrigatório. A prova cobre também override para área da agência, negando agent/manager.
- A única adição ao catálogo SQL revisado é `fn_emit_aviso_da_central()`: função de trigger, tenant de `NEW.organization_id`, sem HTTP, sem EXECUTE para anon/authenticated. Hash e ACL medidos no baseline aplicado em Postgres descartável; os 260 registros anteriores não mudaram.
- Provisionamento continua exigindo `platform_admin` ativo de scope `full`. Admin comum, manager e agent são negados no serviço e na RPC; sem supertoken ou impersonation. Gestão posterior continua por membership oficial e organization switcher. Nenhuma guarda de criação ou policy RLS foi removida.

O Living System Checklist continua respondido em [managed-client-onboarding.md](../architecture/managed-client-onboarding.md): entrada MCP → serviço/RPC → convite/membership/switcher, recibo e auditoria, retry no mesmo tenant. Não nasceu peça de produto adicional nesta integração.

## Validação

A checagem de colisão foi executada antes dos testes usando a árvore staged, sem mover a branch, e repetida no commit antes do push. A primeira rodada detectou duas diferenças reais da integração: o recurso `settings_sons` ainda não mapeado e a função oficial nova ausente do inventário revisado. Os gates foram mantidos e os contratos corrigidos; nenhuma expectativa foi afrouxada.

Resultados finais são registrados abaixo após a rodada dirigida. Build e E2E completo ficam para o GitHub Actions no SHA publicado. Não se reutiliza o PASS do HEAD anterior como prova desta árvore.

- Unit dirigido (`pnpm test:unit`, filtros `managed onboarding require-role auth-dual manifest-x-migrations e2e-cobertura-completa varredura-anon` mais os arquivos unit alterados desde o HEAD de partida, `--maxWorkers=1`): **56 arquivos, 881 testes PASS**.
- Banco dirigido (`pnpm test:db managed quadro-do-onboarding rls-isolation hardening-definer-varredura gov-hardening-anon-definer sons-dos-avisos aviso-da-central-no-barramento`): **11 arquivos, 152 testes PASS**; baseline INSTALL e UPDATE com `ON_ERROR_STOP=1` PASS. Containers exclusivos do harness, removidos no fim; nenhuma conexão com produção.
- A prova SQL de onboarding inclui explicitamente admin comum, manager e agent negados; platform_admin full cria e mantém membership oficial para o switcher. Cadeia de upgrade aplica as 18 migrations renumeradas e reaplica as quatro correções finais.
- ESLint dos arquivos TS/TSX alterados: **exit 0, zero erros e três warnings herdados** (anotação `import()` em dois testes e efeito em `CanalParceiroClient`). A execução adicional com `--max-warnings=0` recusou esses mesmos avisos; não se alterou a regra nem código upstream para escondê-los.
- `pnpm lint:channels`, `pnpm lint:role-rank` e `git diff --check`: PASS.
- Não medidos localmente nesta etapa: typecheck integral, suíte unit integral, build, E2E completo e imagens. Deixados para os runners de Actions; não houve tentativa de build nem disputa com OOM na VPS.
- A proteção de `mcp/stable` foi somente lida: `strict=true`, `enforce_admins=true`, checks `verify`, `invariants`, `imagens-ok`, `e2e`; não foi alterada. PR #20 permanece aberto, sem merge.
- O arquivo não rastreado `leep 2` foi preservado; SHA-256 conferido no começo e antes do commit/push, sem inclusão no índice.
