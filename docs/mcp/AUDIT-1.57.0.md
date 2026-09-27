# Auditoria diferencial v1.53.0-mcp → upstream v1.57.0

Estado: **candidata de release em PR, sem publicação nem deploy**. A última
release MCP publicada é `v1.53.0-mcp`; a instalação em produção continua nessa
versão. Base da PR: `mcp/stable` em
`c577771363c6f1ee81a8a80f2fa4ff45bd133126`, após o merge da
[PR #20](https://github.com/lucascruzfl/DeskcommCRM/pull/20). Branch de
preparação: `feat/mcp-update-157-release`.

## Âncora e escopo

`v1.57.0` é uma tag anotada: o objeto da tag é `dd2a8663a8607e6aaa95af2c8ebfc53e4762d21c` e
`git rev-parse 'v1.57.0^{}'` devolve
`6206bca728a3762f42add7c5773a3a39c4c35abc`. Na base desta PR,
`git merge-base --is-ancestor 6206bca728a3762f42add7c5773a3a39c4c35abc HEAD`
saiu com código 0, e `git merge-base` devolveu o mesmo SHA. O delta oficial foi
medido com `git diff v1.53.0 v1.57.0`; o delta cumulativo do fork, com
`git diff v1.53.0-mcp HEAD`. A integração já ocorreu na PR #20. Esta PR fecha
duas lacunas de paridade (aviso de etapa e restauração de som) e registra o veredito; não altera schema,
instalador nem imagem.

O snapshot local de `MCP_TOOL_COUNT` é **240**, derivado do registry; a contagem
é informativa, não um requisito. `tools/list` e o catálogo derivam do mesmo
registry, e o perfil manager com o preset completo alcança todas as tools
públicas exceto `crm_create_managed_client`.

## Classificação A/B/C do delta oficial

| Operação ou mudança | Classe | Decisão e evidência |
| --- | --- | --- |
| Listar compromissos por período para a grade da Agenda | A | `crm_list_appointments` aceita `de` + `ate`, cursor `depois_de`, fuso explícito e paginação; conserva `contato_id`/`atendente_id` e usa o serviço canônico de agenda. Testes de período e sentinelas MCP cobrem o contrato. |
| Etapa que avisa a equipe na Central | A | A auditoria encontrou um gap: o PATCH oficial e a tela aceitavam `avisar_na_central`, mas `crm_update_stage` não. A tool agora aceita o booleano, chama `atualizarEtapa` (o mesmo serviço da rota), e `crm_list_stages` devolve o estado persistido. O catálogo continua `apenasHumano`; dois testes ficaram vermelhos antes da correção e verdes depois, incluindo recusa cross-tenant. |
| Perda, agentes, Inbox e avisos da Central | A operacional | Os services, rotas e workers oficiais foram integrados. Tools existentes continuam a usar os serviços de leads, funis, agente, mensagens e atendimento; não surgiu outra escrita delegável ausente do registry. |
| Regras de conversão por etapa, ações Google Ads e links rastreáveis | B | As novas Server Actions exigem admin da organização e MFA para escrita; criar ação escreve na conta externa Google. O link público de rastreio é uma entrada HTTP de captação, não uma operação de administração MCP. Não se promoveu a operação privilegiada a tool de manager. |
| Consultar o estado e restaurar som padrão de aviso | A | Segundo gap encontrado: DELETE exige manager e é delegável sem binário. `crm_get_notification_sounds` devolve apenas booleanos de personalização; `crm_reset_notification_sound` exige manager, `settings:write` quando granular, `mcp:write` e `destructive_operations`. Ambas usam `lib/notifications/configuracao-sons.ts`, extraído da rota oficial; HTTP e MCP conservam as outras configurações e não operam sobre arquivos de outra organização. O catálogo deixa a escrita `apenasHumano`, risco crítico, e a policy managed a vincula à área de Notificações. |
| Enviar/ouvir arquivo de som personalizado | B | O POST transporta arquivo binário e o GET devolve URL assinada de bucket privado; o caminho humano é Configurações › Notificações. Nenhuma tool recebe binário ou devolve caminho/URL privada. |
| Retenção de mídia/log, reenfileiramento, disparo de conversões e atualização do kit | C operacional | Crons, dispatchers e manutenção da VPS seguem fora do MCP. A tool não recebe segredo, SQL ou comando de infraestrutura. |
| Criar cliente gerenciado (Fases 5 e 6) | Exceção privilegiada explícita | `crm_preflight_managed_client` é leitura sem efeito; `crm_create_managed_client` exige confirmação, capability e `platform_admin` ativo com scope `full`. É criação transversal de tenant, fora do conjunto A delegável ao manager. A exceção tem policy, serviço e RPC próprios, sem acesso universal. |

A revisão cobriu as novas rotas `rastreio/[id]` e `settings/sons`, as três novas
Server Actions de conversões, as mudanças em `app/app`, `components`, `hooks`,
`lib`, `workers`, `supabase`, no catálogo/policy/scopes/capabilities MCP e no
kit de atualização. Para o denominador A — operação org-scoped canônica e
delegável a manager — os dois gaps encontrados foram fechados e **não há gap conhecido:
`gaps_a = 0`**. Os limites B/C
acima permanecem intencionais; a contagem de tools não foi usada para zerar a
matriz.

## Segurança de `crm_create_managed_client`

| Ator | Resultado |
| --- | --- |
| `platform_admin` ativo, scope `full`, membership atual, capability e confirmação | Pode executar pelo serviço e pela RPC; recebe recibo e convite oficial. |
| Admin comum da organização | **DENIED** em `tools/list`, chamada direta, serviço e RPC. |
| Manager sem privilégio de plataforma | **DENIED** nas mesmas camadas. |
| Agent | **DENIED** nas mesmas camadas. |

`lib/mcp/auth.ts` reconsulta `platform_admins` e membership atual pelo usuário
que emitiu o bearer. `lib/mcp/policy.ts` filtra a tool antes de registrar
`tools/list` e repete a autorização na chamada. O serviço revalida o ator, e
`fn_begin_managed_client_onboarding` exige novamente `scope = 'full'` no banco;
anon/authenticated não ganham EXECUTE. A tool só usa o ator do token, sem
impersonation e sem supertoken. O preflight e `confirm=false` não criam dados;
retry usa o mesmo recibo/tenant. A prova SQL em
`tests/invariants/managed-onboarding-real.test.ts` exercita as três recusas,
membership, isolamento, replay e retomada. O mapa vivo e o laço de retorno estão
em [managed-client-onboarding.md](../architecture/managed-client-onboarding.md).

## Migrations e instalação

O delta oficial após 1.53 acrescenta `0434`–`0442`; `0440`–`0442` colidiam
com os números antigos da linha managed. A integração renumerou as **18
migrations managed ainda não distribuídas** para `0458`–`0475`, com timestamps
posteriores aos oficiais e SQL executável preservado. A tripla versionada,
`supabase/baseline.sql` e `supabase/migrations/MANIFEST.md` acompanha a ordem.
A verificação da árvore contou **387 arquivos SQL, zero NNNN duplicado e zero
timestamp duplicado**. A reconciliação da migration MCP `0382` com a oficial
`0385` é a exceção histórica já documentada em [AUDIT-1.53.0.md](AUDIT-1.53.0.md),
sem nova alteração nesta PR. [O registro da Fase 6](../security/phase6-upstream-157-integration.md)
descreve cada renumeração e a ordem das dependências.

O teste `managed-client-upgrade-chain.test.ts` aplica as 18 migrations sobre
dados anteriores à cadeia managed e reaplica as quatro correções finais. O
workflow de publicação ainda exige instalar o baseline da última tag MCP e
aplicar o novo baseline, em PostgreSQL 15 e 17, antes de criar qualquer imagem
ou manifesto. Esse gate permanece obrigatório no corte da release.

## Gates e limites da medição

- [PR #20](https://github.com/lucascruzfl/DeskcommCRM/pull/20), merge commit
  `c5777713`: checks `verify`, `invariants` (PG 15 e 17), `e2e`,
  `build-and-size` e `imagens-ok` concluídos com `SUCCESS` para a árvore de
  código promovida. Os checks de publicação `build-and-push` e `promover-stable` ficaram `SKIPPED`; os checks de validação não equivalem a publicação.
- Rodada dirigida: sentinelas, fluxos MCP, segurança managed, serviço de
  onboarding, MANIFEST, catálogo, mapa vivo, etapa e sons — **10 arquivos,
  965 testes PASS**. As cercas de cliente administrativo/filtro de tenant
  passaram em dois arquivos (12 casos); sons, depois do reforço do double,
  passaram em 14 casos. Nenhum teste usou credenciais ou tenant de produção.
- `pnpm test:shell`: PASS. A primeira rodada expôs uma fixture que simulava
  ausência de Docker com um PATH que continha Docker neste host. A fixture
  agora isola somente os binários necessários; todos os asserts foram mantidos.
- `pnpm lint`: PASS, zero erros e 440 avisos preexistentes; ESLint dos arquivos
  alterados: PASS. `lint:channels`, `lint:role-rank`, nove testes Python do
  upstream/manifest, `release:conferir`, colisão e `git diff --check`: PASS.
  O conferidor de fragmentos foi executado sem `--escrever`.
- Upgrade real desde o baseline extraído de `v1.53.0-mcp`: PASS em PG 15 e 17.
  Dez linhas preservadas e oito objetos mantêm identidade; reaplicação preserva
  a view migrada. Containers isolados removidos pelo harness.
- `pnpm typecheck` completo foi executado duas vezes e morreu por limite de
  heap local (2 GB e 2,5 GB), sem diagnóstico TypeScript. O host é compartilhado
  com produção e não se expandiu o orçamento. Typecheck dirigido dos arquivos
  alterados e imports: PASS, com configuração temporária fora do repo; isso
  não substitui o gate completo do CI.
- `pnpm test:db` e `pnpm test:unit` completos estão em execução. Uma rodada com
  Node 22.16 falhou no teste real de tsx/PDF; Node 22.23.3 passou os 16 casos
  sem mudar o teste. A suíte foi reiniciada com essa versão. Uma cerca de
  varredura da suíte ampla ultrapassou o timeout local; não foi enfraquecida.
- Build e E2E/QA visual desta candidata não foram medidos localmente: memória
  limitada e ausência de ambiente E2E fresco configurado. CI/E2E da PR #20
  medem a base, não certificam as correções desta PR.
- Esta PR precisa repetir os checks no seu próprio SHA. O workflow
  `publish-mcp-release.yml` verifica ancestralidade, JSON, salto de banco,
  typecheck, lint, testes, build, quatro imagens e digests antes de publicar.
  Este documento não substitui esses gates nem autoriza atualizar a VPS.

`mcp_compatible = false` mantém o veredito bloqueado enquanto os gates da
árvore final não estiverem confirmados. A cobertura funcional A não implica
publicação autorizada. Nenhuma tag
`v1.57.0-mcp`, GitHub Release, manifesto de publicação ou deploy é criada por
esta PR de preparação.

### Living System Checklist — aviso de etapa pela tool

Entrada: `crm_update_stage` recebe `avisar_na_central` de um manager autorizado.
Saída: `lib/leads/stage-operations.ts` grava a configuração; quando o negócio
entra na etapa, `lib/leads/aviso-de-etapa.handler.ts` abre o aviso. O mesmo estado
volta por `crm_list_stages` e pela tela Funis › Etapas. A mutação emite
`pipeline.stage_updated` para `api_audit_log`; o aviso é visível na Central, cuja
porta já está no menu. Sem configuração, o padrão é desligado e a tela mostra o
switch; sem negócio entrando, não existe demanda pendente criada pela tool. O
humano decide a configuração, o agente consulta o estado estruturado e a
correção volta pelo mesmo switch/tool. O mapa
`docs/architecture/central-avisos.architecture.json` já liga configuração,
evento, aviso e campainha; `ia-360-organizar.architecture.json` já liga a tool
ao serviço de etapas. O mapa da Central foi atualizado com a ligação MCP → serviço compartilhado dos sons.

### Living System Checklist — som padrão

A entrada MCP validada recebe somente `tipo`, nunca organização, caminho ou URL.
A organização vem do token autenticado; as queries administrativas filtram seu ID.
O mesmo serviço serve a tela e o MCP, preserva o restante de `settings` e grava antes
de remover o áudio antigo. O som padrão mantém o aviso audível; não nasce demanda
pendente. Falha de leitura/gravação devolve erro, sem configuração vazia nem sucesso
falso. O retorno estruturado e a consulta seguinte mostram o estado; a tela já tem
controle para restaurar e enviar outro arquivo. HTTP audita o efeito, MCP usa a
trilha universal da chamada e recurso organização. O mapa vivo explicita a ligação
à Central/campainha. A nova superfície é núcleo do fork MCP, não extensão de nicho.
