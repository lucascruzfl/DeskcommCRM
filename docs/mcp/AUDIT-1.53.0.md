# Integração MCP v1.53.0 — manutenção pré-Fase 6

Alvo alterado de v1.52.0 para v1.53.0 por instrução explícita do operador nesta sessão.
Alvo congelado: `v1.53.0`, commit `f5701b42bada06ee330701476bf1c28432cb2918`.
Base MCP: `0a7511a886f12f5f699bac2aceedf957d179a3d3`, última release `v1.47.0-mcp`.
Branch: `feat/mcp-update-1.53`. Integração cumulativa por merge, sem reescrever histórico.

## Preservação

Fase 5: `190df40c3` e `4d4b98c56` estão na branch remota
`feat/managed-aesthetic-clinic-onboarding`. Runs `36248570491` (E2E) e
`36248570500` (CI) confirmadas com conclusão success para `4d4b98c56`.
A branch certificada não foi modificada para iniciar esta integração.
O arquivo não rastreado `leep 2` é uma captura ANSI de `git diff --stat`
(14.261 bytes), provavelmente criada por redirecionamento acidental. Preservado,
fora dos commits. Nenhum arquivo de ambiente nem dado de produção foi lido.

## Versão exibida

O heartbeat de `hostgator-setup-kit/agent.sh` reporta `current_version=git SHA`
quando HEAD não corresponde exatamente a uma tag. A rota `system/version`
usava essa coluna para afirmar a versão instalada; `APP_VERSION` só era lida
para desmentir um rollback. `VersionFooter` exibia o resultado sem distinguir
release de revisão. `package.json` tem versão interna 0.1.0, sem autoridade de
release. Os Dockerfiles recebem APP_VERSION e o workflow MCP publica a mesma
versão no label OCI; o label de revisão permanece separado.

A rota agora prioriza APP_VERSION sem hardcode, mantendo a release confirmada
pelo host como fallback quando a imagem não traz metadata. Um SHA só sai em
`build_revision`. O rodapé apresenta a release inteira e Build separadamente.
Nenhuma consulta à produção: 1.47.0-mcp é a versão informada pelo operador.

## Resolução semântica

Preservadas operações compartilhadas HTTP/MCP, catálogo Full Control, filtros
adicionais de leads, autorização, scopes, capabilities e limites. Integrados
rascunhos de conversa, retomada, previsão, categorias de perda e regras de ganho
nas operações compartilhadas. O limite de envio por token fica dentro do efeito
protegido por idempotência, preservando a nova regra upstream para retries.
Preservados limites de viewport, footer de Sheet e espaço das ações em lote,
junto aos novos layouts e testes oficiais. Instalador e atualizador usam releases
publicadas no canal oficial e manifest/digests validados em custom-mcp.

## Migrations

A identidade da migration MCP 0382 foi preservada. A de link salvo oficial já
estava normalizada como 0385 na linha MCP, com o timestamp oficial preservado;
esta integração não muda essa decisão histórica. Baseline combina o apêndice
FAQ MCP e os novos apêndices oficiais. Nenhuma migration aplicada foi apagada
ou teve seu timestamp alterado nesta integração.
O verificador local deve comparar contra `fork/mcp/stable`: comparar o fork
contra o NNNN bruto da tag oficial dá uma falsa colisão 0382, cuja reconciliação
0385 já está guardada por `manifest-x-migrations.test.ts`.
As migrations managed 0425–0437 permanecem na branch certificada. A reconciliação
dessa branch só acontece depois de validar e promover a release MCP.

## Living System Checklist — versão instalada (infraestrutura)

1. Entrada: APP_VERSION da imagem e system_version/current_sha do heartbeat.
2. Saída: API autenticada → useSystemVersion → VersionFooter e UpdatePanel.
3. Registro: leitura pura; sem mutação e sem novo evento. Erros de banco usam logger.
4. Tela: rodapé do menu e Configurações › Atualização do sistema.
5. Porta: sidebar e destino existente /app/settings/atualizacao.
6. Anti-morte: não se aplica a leitura; poll existente reconsulta a cada cinco minutos.
7. Configuração: metadata do workflow de release, sem nova variável obrigatória.
8. Continuidade IA/humano: não se aplica a metadata de instalação.
9. Retorno: release executada corrige automaticamente o SHA de um heartbeat posterior.
10. Mapa: fluxo existente host→API→UI; não há peça nova de arquitetura.

## Validação

Resultados e runs devem ser registrados após execução. Nenhum gate pendente é
tratado como PASS. Publicação, manifest e promoção de mcp/stable ficam bloqueados
até CI, E2E, MCP, migrations e imagens validados. Não executar update, tenant,
convite, token real ou onboarding service. can_execute permanece false.

### Guarda de commit entre branches

O hook bloqueou o merge por cinco NNNNs (0425, 0426, 0427, 0428 e 0432)
e um timestamp (20260926120000) usados também na branch managed certificada.
Não há duplicata na árvore integrada: são branches divergentes, não duas
migrations aplicadas nesta release. A integração mantém os arquivos oficiais
byte a byte e os timestamps oficiais. O escape documentado
`DESKCOMM_MIGRATION_EDIT=1` é usado apenas para registrar este merge conhecido,
sem renomear migrations oficiais já publicadas. A branch managed será reconciliada
antes de seu próprio merge/revalidação; nenhuma migration managed foi aplicada
em produção, conforme o contexto certificado informado pelo operador.

### Gates locais executados

- Versão/API/rodapé e runtime MCP: 48 testes passaram em quatro arquivos.
- MCP e rotas afetadas: 295 testes passaram em 33 arquivos.
- Verificador migration/MANIFEST: nove testes passaram; colisão contra mcp/stable: PASS.
- Runtime tools/list usa os handlers reais pelo InMemoryTransport do SDK; zero duplicatas.
  Allowlist de leitura reduz a lista e chamada direta de retomada fora dela é negada.
- Baseline fresco e reaplicação vazia: PASS (ON_ERROR_STOP=1).
- Upgrade com dados desde o baseline da v1.47.0-mcp: PASS, dez linhas preservadas,
  oito objetos mantêm identidade; nova reaplicação preserva a view migrada.
- test:shell: PASS, incluindo installer, custom-mcp e fail-closed.
- Lint: zero erros; avisos preexistentes da suíte permanecem.
- Python MCP upstream/manifest: nove casos PASS.
- CI inicial c123a0e07 detectou imports automesclados em auth-dual usando nomes
  antigos de rate-limit e requestId faltante no erro de Idempotency-Key. Correção
  reutiliza MCP_RATE_LIMITS e correlaciona o erro. Sem alteração dos limites.
- Controle negativo da versão: retirando a prioridade APP_VERSION, exatamente
  três dos seis casos ficaram vermelhos. Fonte restaurada após o ensaio.
- Publicação antes de promover stable: dispatch explícito de candidato exige
  os cinco checks verdes no mesmo commit. Falha, cancelamento, skip e ausência
  de check bloqueiam. O gate de build-and-size passa a cobrir PRs para mcp/stable.
