# Revisão local de paridade v1.57.0-mcp → v1.62.0

## Estado vigente — fase 2, 2026-10-03

A auditoria atual está em [Propostas fase 2](PROPOSTAS-FASE2-1.62.0.md)
e [revisão diferencial final](DELTA-1.57-1.62-FINAL.md).
Os gaps A conhecidos estão cobertos localmente; todos os gates finais passaram. As seções abaixo preservam os checkpoints anteriores.

## Fechamento validado — 2026-10-03

Revisão diferencial concluída: **gaps A conhecidos = 0**. Matrizes vigentes em
[Propostas fase 2](PROPOSTAS-FASE2-1.62.0.md) e
[delta final](DELTA-1.57-1.62-FINAL.md). B/C permanecem deliberadamente fora do MCP.

Candidato hermético `/tmp/deskcomm-phase2-162`, sem .env da VPS, com o mesmo
código da árvore local. Nenhum arquivo foi editado durante cercas/unit/db.

| Gate final | Resultado |
|---|---|
| Dirigidos MCP/HTTP/policy/catálogo/capability/tenant/audit | 43 arquivos, 1.581 testes verdes |
| Banco dirigido | 8 arquivos, 57 testes verdes; INSTALL/UPDATE verdes |
| Typecheck, NODE_OPTIONS=--max-old-space-size=6144 | código 0 |
| Lint | código 0, 0 erros, 465 warnings |
| lint:channels / lint:role-rank | códigos 0 |
| Cercas completas | 265 arquivos, 2.587 testes verdes |
| Unit completo | 1.707 arquivos, 18.409 passaram, 1 falha esperada; código 0 |
| Banco completo | 326 arquivos, 2.694 passaram, 1 falha esperada, 1 ignorado; código 0; INSTALL/UPDATE verdes |
| skills:sync | código 0, árvore original e candidato |
| git diff --check | código 0 |

A execução unitária inicial completa revelou três regressões locais:
seleção do pacote organizar acima do teto, declaração posicional invisível
à cerca e mock de catálogo incompleto após novos imports. Foram corrigidas,
com A/B na base quando aplicável, e o unit **inteiro** foi repetido verde.
O candidato e a base passam na cerca exata de hidratação; uma corrida anterior
sob concorrência excedeu o tempo e foi interrompida, sem receber selo verde.
A repetição completa usa configuração temporária fora do repo apenas para
escalonar cercas com 1 worker antes do produto com 2. Inventários original e
temporário conferidos: os mesmos 1.707 arquivos, sem omissões/acréscimos;
nenhum timeout, asserção, include/exclude ou código de teste foi relaxado.

O banco interrompido pela perda da sessão não é gate: o container descartável
foi removido e o banco **completo** repetido verde, com teardown automático.
Não foram corrigidos problemas preexistentes sem evidência. As traduções e
fragmento foram ajustados às cercas reais. Controle negativo documental
(status rascunho retirado) ficou vermelho; regra restaurada e suítes verdes.

Condições do commit local satisfeitas. Staging somente por caminhos explícitos;
mensagem autorizada: `fix(mcp): fechar paridade da v1.62`.
`leep 2` não foi aberto, lido, copiado, movido, apagado nem adicionado.
`backups/` não foi aberto, alterado nem apagado.
Sem push, PR, tag, release ou deploy; produção não foi alterada.

## Retomada local — 2026-10-02

Branch e HEAD confirmados: `fix/mcp-b2b-parity-162` em
`fc4d663c795ebf994516d02274179120deb0b953`. Foram recuperados 18 arquivos
rastreados modificados e 18 novos relevantes, sem staging. B2B (13 tools),
relatório por etiquetas e duas criações internas de honorários já existiam.
Propostas tinha apenas auditoria; listagem geral de contratos não existia.

Nesta retomada foram implementadas as três tools administrativas de propostas
(listar, obter com itens/drift, editar rascunho) e a listagem de contratos de
honorários sem lead obrigatório. A matriz histórica A/B/C permanece válida;
esses quatro gaps A passam a **cobertos localmente, com validação parcial**.
A matriz e o contrato atual estão em `PROPOSTAS-PARITY-1.62.0.md`, seção Retomada.

O inventário diferencial local `git diff --name-only v1.57.0-mcp v1.62.0 --
app/api/v1 app/actions lib supabase/migrations` foi retomado. A leitura das
rotas confirmou o grande conjunto adicional A de documentos, revisão,
sugestões e modelos. **Ponto de parada solicitado pelo usuário** antes de
expandir. Acervo, grupos, pagamento de honorários, anexos e restante do delta
continuam pendentes; revisão diferencial incompleta, sem veredito de paridade.

Worktree hermética: `/tmp/deskcomm-recovery-162-7qxbxytu`, HEAD destacado na
mesma base, patch rastreado e cópia individual dos novos paths relevantes.
Sem `.env`, backups ou arquivo protegido; dependências via symlink de
node_modules (somente testes/tsc, sem build Next). Node 22.23.3 / pnpm 9.15.9.
Nenhuma edição durante as execuções de suíte.

Gates já medidos nesta retomada:

- Dirigidos: duas rodadas, códigos 0; 10 arquivos/130 testes + 6 arquivos/874
  testes (16 arquivos/1004 testes). Incluem HTTP, B2B, reports, honorários,
  propostas, catálogo, compatibilidade, fluxos finais, role/scope e auditoria.
- Banco dirigido: código 0; 5 arquivos/47 testes, INSTALL e UPDATE verdes,
  RLS B2B/propostas/honorários e MCP cross-tenant; container descartável removido.
- Primeiro typecheck: código 2; incompatibilidade de variance na coleção das
  tools do teste novo e idioma opcional do handler. Corrigidos para coleção
  genérica de registry e fallback explícito pt-BR. Resultado final pendente.
- Cercas, unit completo e db completo não foram executados: gaps A grandes
  continuam abertos, condição do passo 6 para gates finais não satisfeita.
- Verdes históricos abaixo não são gates finais desta retomada.

Sem commit, staging ou operações externas. Arquivo protegido e backups não
foram abertos, lidos, copiados, movidos, apagados ou adicionados ao Git.

### Resultado final do recorte nesta retomada

- Dirigidos finais: código 0, **20 arquivos / 1235 testes**. Esta rodada
  substitui as duas rodadas preliminares, não se soma a elas.
- Controle negativo: retirar o filtro de tenant da listagem na worktree fez
  o caso de listagem sem filtro falhar (2 resultados em vez de 1), código 1.
  O primeiro controle revelou que faltava esse caso; a asserção foi adicionada,
  o controle ficou vermelho e o handler foi restaurado antes dos gates finais.
- Typecheck final: código 0 com `NODE_OPTIONS=--max-old-space-size=6144`.
- Lint final: código 0, **0 erros / 465 warnings**.
- Channels e role-rank: ambos código 0.
- Banco dirigido: código 0, 5 arquivos / 47 testes; sem edição concorrente.
- Skills sync: código 0 na worktree e na árvore principal; oito espelhos fiéis, sem mudança gerada.
- Diff check: código 0 na árvore principal.
- Nenhum gate amplo foi reaproveitado como final: cercas, unit completo e db
  completo permanecem não executados nesta retomada, enquanto gaps A grandes
  estiverem abertos.

A implementação do recorte está validada pelos checks acima. A branch **não
está pronta para commit de fechamento**: revisão diferencial incompleta e gaps
A adicionais documentados. Não houve QA visual ou prova com agente real; os
checks medem handlers/tools, policy, audit e invariantes do banco descartável.

## Checkpoint anterior (histórico)

Estado: **incompleto; sem commit de paridade e sem release**. Base original `fc4d663c795ebf994516d02274179120deb0b953`. Destino: núcleo MCP com módulos oficiais opcionais; com zero módulos ligados, a operação comum continua inteira.

## Continuação: auditoria de Propostas

A matriz por operação está em [PROPOSTAS-PARITY-1.62.0.md](PROPOSTAS-PARITY-1.62.0.md).
Listar, obter com itens/drift e editar rascunho continuam A. A auditoria também
identificou uma segunda fase grande de operações A em documento estruturado,
revisão, sugestões e modelos textuais. Conforme a instrução do usuário, a
sessão parou antes de implementar ou ampliar a branch. Envio, decisão do
cliente, confirmação de modelo, aplicação de sugestões já revisadas e importação
binária não foram expostos. Listagem geral de honorários continua A aberta.

Nenhuma tool nova ou gate amplo foi executado nesta continuação; nenhum commit.
A matriz e os gates abaixo são o checkpoint anterior e não encerram a paridade.

## Prova hermética anterior às três tools adicionais

Base: `/tmp/deskcomm-mcp-162-base-fc4d663`. Candidata: `/tmp/deskcomm-parity-162-check`, materializada por diff Git e cópia explícita de 10 arquivos novos B2B/MCP. Nenhuma cópia recursiva da raiz. Sem `.env`, backups ou arquivo protegido da VPS. Node 22 e a mesma instalação de dependências nos dois worktrees.

- Namespace, marcador de hidratação e system/update/version: 62/62 passaram em cada lado, código 0.
- system/update vermelho na raiz da VPS: **ambiental**, o `.env` local aciona a recusa de release MCP; o mesmo código passa nas duas árvores herméticas sem `.env`.
- Namespace: **não reproduzido nas árvores herméticas**. A varredura no disco da VPS pode alcançar artefatos ignorados; não foram abertos nem alterados para demonstrar qual backup contém o literal. Não atribuir um arquivo específico sem prova.
- Hidratação: **não reproduzido isoladamente**; o A/B do marcador passa nos dois. Isso afasta regressão nesse teste, mas não prova a causa do timeout anterior sob carga.
- Banco: execução hermética sem edição concorrente, código 0, 326 arquivos; 2694 passaram, 1 falha esperada e 1 ignorado (2696). INSTALL e UPDATE verdes. A rodada anterior permanece inválida por edição concorrente.
- Esse banco verde mede o candidato B2B anterior à extração de reports/honorários. Não é prova de banco do candidato final com as três tools adicionais.

## Matriz diferencial e ponto de parada

A classe A exige org confiável, operação canônica, manager autorizado e delegação razoável. B exige fluxo humano/binário/segredo ou efeito externo; C é infraestrutura/plataforma sem operação delegável do tenant. `Pendente` não é uma conclusão A/B/C.

| Operação                                   | Arquivo/rota                                                                                                                 | Papel HTTP                  | Efeito                                                                              | MCP existente?                                                | Classe        | Justificativa / estado                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cadastros, vínculos e leitura de lotes B2B | `/companies`, `/people`, `/company-people`, `/contacts/:id/person`, `/imports`                                               | viewer/manager              | Cadastro interno e leituras org-scoped                                              | 13 tools B2B locais                                           | A             | Preservadas; testes dirigidos e banco hermético verdes.                                                                                                                                      |
| Upload e enriquecimento B2B                | POST `/imports`, `/companies/:id/enrich`                                                                                     | manager                     | Binário e consulta BrasilAPI                                                        | Não                                                           | B             | Fluxo humano preservado.                                                                                                                                                                     |
| Relatório por etiqueta                     | GET `/reports/tags`; `lib/reports/tags.ts`                                                                                   | viewer; RLS de sessão       | Volume/desfecho/espera por conversa; janela ≤90 dias, fuso, paginação e truncamento | `crm_get_tags_report` local                                   | A             | Handler extraído da rota, sem SQL duplicado. MCP exige manager para agregado via service role; `conversations:read`, área `/app/inbox`. Filtros e erros redigidos.                           |
| Criar contrato de honorários               | POST `/honorarios/contratos`; `lib/honorarios/handlers.ts`                                                                   | manager                     | Apenas insert interno; sem caixa, PIX, boleto, cartão, gateway ou segredo           | `crm_create_honorarios_contrato` local                        | A             | Org do contexto, lead do tenant; módulo `honorarios`, `operations:write`, área `/app/honorarios`. Criação não idempotente como HTTP: resposta incerta não deve ser repetida automaticamente. |
| Criar parcela                              | POST `/honorarios/contratos/:id/parcelas`; mesmo handler                                                                     | manager                     | Parcela pendente; não registra pagamento                                            | `crm_create_honorarios_parcela` local                         | A             | Confere contrato na org inclusive com service role. UUID/data real; conflito natural `(contrato_id, numero)`; sem `status`/`financial_entry_id` públicos.                                    |
| Ver contrato e parcelas                    | GET `/honorarios/contratos`, `/honorarios/contratos/:id/parcelas`                                                            | viewer                      | Leitura interna                                                                     | `crm_get_honorarios_contrato`, `crm_list_honorarios_parcelas` | A             | Tools existentes para consulta por lead/contrato; não equivalem à listagem geral de contratos.                                                                                               |
| Listagem geral de contratos                | GET `/honorarios/contratos` sem lead_id                                                                                      | viewer                      | Lista interna org-scoped via RLS                                                    | Não; get por lead é outra operação                            | **A aberto**  | Gap adicional pequeno identificado na revisão; não implementado após o ponto de parada no domínio grande de propostas.                                                                       |
| Registrar parcela paga                     | POST `/honorarios/parcelas/:id/pagar`, RPC da 0480                                                                           | manager                     | Caixa interno atômico e parcela paga; sem gateway                                   | Não                                                           | Pendente      | RPC exige sessão humana `auth.uid()`; avaliar delegação/proveniência da confirmação do pagamento antes de expor.                                                                             |
| Listar propostas                           | GET `/proposals`                                                                                                             | viewer                      | Leitura org-scoped                                                                  | Não                                                           | **A aberto**  | `crm_draft_proposal` e `crm_preparar_proposta` não listam propostas.                                                                                                                         |
| Obter proposta e itens                     | GET `/proposals/:id`                                                                                                         | viewer                      | Leitura org-scoped, itens e drift de catálogo                                       | Não                                                           | **A aberto**  | Operação canônica sem binário/segredo/serviço externo obrigatório.                                                                                                                           |
| Editar rascunho                            | PATCH `/proposals/:id`                                                                                                       | agent (manager herda)       | Edição interna com revision e estado rascunho                                       | Não                                                           | **A aberto**  | Domínio grande novo; não ampliar automaticamente a implementação.                                                                                                                            |
| Demais operações de propostas/modelos      | `/proposals/:id/*`, `/settings/proposal-templates/*`, `/settings/proposals`; `lib/propostas`; migrations 0486–0499/0476/0477 | variável                    | Revisão, documento, envio, modelos, configurações                                   | Duas tools de preparo/draft                                   | Pendente      | **Ponto de parada**: domínio grande com ciclo de vida, estado, revision, custos de IA, documentos e envio. Exige auditoria própria.                                                          |
| Busca no acervo                            | POST `/ai/knowledge/busca`                                                                                                   | agent                       | Busca canônica e telemetria; embedding externo                                      | `crm_search_knowledge`                                        | Pendente      | Verificar equivalência do acervo/limiar/telemetria; ainda não concluir gap.                                                                                                                  |
| Escolha de embedding                       | PUT `/ai/knowledge/provedor`                                                                                                 | admin                       | Troca fornecedor e reenfileira base                                                 | Não                                                           | B             | Privilégio acima de manager e uso de credencial/fornecedor.                                                                                                                                  |
| Venda pelo canal                           | action `definirVendaPeloCanal`                                                                                               | admin                       | Configuração de conversões externas                                                 | Não                                                           | B             | Não é delegável a manager; MFA da sessão.                                                                                                                                                    |
| Grupos da sessão                           | GET/PUT `/channel-sessions/:id/groups`                                                                                       | manager                     | Consulta/configuração WAHA de grupos                                                | Não                                                           | Pendente      | Integração externa e consentimento da operação; auditar antes de classificar.                                                                                                                |
| Anexos em notas                            | `/conversations/:id/notes/*/media`                                                                                           | variável                    | Upload/download binário privado                                                     | Fluxo de mídia existente, equivalência pendente               | B para upload | Não transportar arquivo/credencial via MCP; leitura deve preservar escopo.                                                                                                                   |
| Instalar módulos                           | `/modulos`, `/modulos/instalar`; `lib/modulos`                                                                               | administrador da instalação | Provisiona tabelas oficiais                                                         | Não                                                           | C             | Operação da instalação, fora da delegação manager do tenant.                                                                                                                                 |
| Workers/crons e migrations restantes       | `workers/*`, cron de propostas/lead-time-triggers, migrations novas                                                          | interno/plataforma          | Evolução de execução e schema                                                       | Não se aplica diretamente                                     | Pendente      | Inventário diferencial feito; auditoria completa interrompida no domínio grande de propostas.                                                                                                |

A revisão **não terminou** e não afirma ausência de outros gaps A.

## Contratos e provas das três novas tools

Dirigidos: `lib/mcp/tools/parity-162.test.ts`, rotas HTTP de honorários e `tests/unit/reports-por-etiqueta.test.ts`. Cobrem happy path, role, scopes, allowlists, token full anterior, registry/catalog, módulo OFF/ON, managed policy, tenant real nos dublês, UUIDs, datas, refinamento de modelo, parcela duplicada e auditoria sem filtros ou valores financeiros crus. Os dirigidos B2B seguem na mesma rodada: 8 arquivos, 64 testes verdes.

Living System Checklist: entrada pelo token autorizado ou pelas rotas HTTP; saída pelo relatório MCP e registros da tela `/app/honorarios`; auditoria de efeito dos handlers e auditoria universal; configuração pelo catálogo/scopes e módulo oficial. Leituras não criam demanda; registro de contrato/parcela não decide se o cliente pagou. Erros devolvem recusa para correção explícita pelo operador; resposta incerta não autoriza repetição automática. O mapa `mcp-fundacao-ia.architecture.json` liga HTTP e MCP aos mesmos serviços, banco e auditoria.

## Gates ao encerrar esta etapa

Candidata final da etapa: 35 paths explícitos em `/tmp/deskcomm-parity-162-materialized.txt` (18 rastreados alterados + 17 novos), conferidos por conteúdo contra a árvore principal. Sem arquivos operacionais da VPS.

- Typecheck hermético: código 0, `NODE_OPTIONS=--max-old-space-size=6144`.
- Lint hermético: código 0, 0 erros e 465 warnings. Channels e role-rank: código 0.
- Cercas herméticas: código 0; 265 arquivos, 2585 testes passaram.
- Dirigidos herméticos B2B + novos gaps + rotas HTTP: 8 arquivos, 64 testes passaram.
- Skills sync hermético: código 0; oito espelhos fiéis, sem mudança gerada.
- Unit completo: **não executado nesta etapa**.
- DB do candidato final com as três tools adicionais: **não executado**. O verde de 326 arquivos/2694 testes é anterior a elas.
- Diff check principal e candidato: código 0.

Sem commit. O ponto de parada é o domínio grande novo de propostas, conforme instrução do usuário; não há declaração de branch pronta, ausência de gaps A ou paridade concluída. Backups e arquivo protegido da VPS não foram abertos, copiados, movidos, apagados, adicionados ou alterados. Sem push, PR, tag, release ou deploy.
