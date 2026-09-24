# Auditoria diferencial 1.42.0-mcp → upstream v1.47.0

Estado: **candidata integrada; publicação bloqueada até CI completo**. A
[release oficial v1.47.0](https://github.com/melgarafael/DeskcommCRM/releases/tag/v1.47.0)
aponta para `ebb7d03e9896468d197df168b19bdd682e2beb48`. O upstream mudou
412 arquivos entre as tags 1.42 e 1.47; a diferença 1.46 → 1.47 tem 105.
A última release MCP pronta continua `v1.42.0-mcp`. As auditorias
[1.45](AUDIT-1.45.0.md) e [1.46](AUDIT-1.46.0.md) documentam as mudanças
intermediárias; elas não foram publicadas como MCP.

## Detecção e resolução dos conflitos

O [detector do fork](https://github.com/lucascruzfl/DeskcommCRM/actions/runs/35981113557)
encontrou seis conflitos ao integrar a tag sobre a linha MCP estável, abriu a
[issue #6](https://github.com/lucascruzfl/DeskcommCRM/issues/6) e não publicou.
A candidata aproveita a resolução manual e os gates verdes da 1.46. O merge
incremental 1.46 → 1.47 teve dois conflitos:

- A Agenda já recebeu no upstream a mesma correção que o E2E exigiu na
  candidata MCP: a busca precisa cobrir as 42 células da visão Mês. Mantivemos
  o helper canônico `lib/agenda/recorte-da-grade.ts`, compartilhado com o
  desenho da grade e cobrado pelo teste oficial.
- O baseline precisava conter tanto a função MCP de substituição atômica de
  FAQ quanto os novos blocos oficiais 0394–0397. Ambos ficam **antes** da
  varredura que revoga a execução anônima de funções. Nenhum bloco oficial
  foi descartado; a diferença do baseline integrado contra a tag é só a
  função MCP de FAQ.

## Classificação A/B/C da 1.47

| Delta oficial | Classe | Cobertura ou limite |
| --- | --- | --- |
| A conversa fica com quem atendeu | A | `crm_get_routing_config` já lê o novo booleano; `crm_update_routing_config` agora o aceita como booleano opcional, exige manager e `mcp:write`, usa o schema e a mescla oficiais e audita a mudança. Ausência preserva `false` ou o valor já salvo. |
| Base dos roteiros de atendimento | C por ora | Módulo da instalação desligado por padrão e ainda sem tela; o servidor recusa ligá-lo. MCP não oferece ativação da plataforma. `crm_create_followup_flow` anuncia apenas `name`, pois continua criando follow-up comum e ignoraria `surface=atendimento`. Reavaliar quando o upstream entregar a superfície operável. |
| Mês da Agenda consulta seis semanas | A operacional | Helper oficial substitui a correção local equivalente; E2E de ocupação do Google na célula de mês vizinho e teste do helper são gates. |
| Resposta do Inbox, rascunho seguinte e refetch de segurança | A operacional | Código oficial integrado; E2E e testes de mensagens protegem o fluxo. MCP usa o mesmo serviço de envio, sem novo contrato externo. |
| Roteiro encerra por humano, opt-out ou prazo | C por ora | Mesmo módulo ainda desligado; triggers, RLS, LGPD e scheduler ficam no baseline e nos invariantes. Nenhum token MCP pode ligar o módulo da plataforma. |
| Migrations 0394, 0396 e 0397 | A de instalação | Baseline oficial acumulado e migrations integradas. A migration oficial de memória, ainda não publicada na linha MCP, recebeu `0398` e timestamp posterior para não colidir nem inverter a ordem de aplicação. |

As seis tools acrescentadas na integração 1.43–1.46 permanecem no catálogo;
nenhuma tool nova foi inferida só da contagem. `tools/list` é a referência.
O snapshot atual é 232, informativo. Os gaps A identificados foram tratados,
mas o total permanece **indeterminado** até os gates da árvore final passarem.
`RELEASE-AUDIT.json` segue em 1.42.0 e impede publicação.

## Salto de banco e gates

O instalador e o updater aplicam o baseline acumulado; não precisam publicar
1.43, 1.44, 1.45 e 1.46 separadamente. O harness instalou o baseline da tag
`v1.42.0-mcp`, semeou dez linhas e reaplicou o baseline integrado 1.47 com
`ON_ERROR_STOP=1` em PostgreSQL 15 e 17. Dados, OID da view de ocupação e
oito identidades de objetos inspecionados sobreviveram; uma view legada 1.26
foi migrada e ficou estável na segunda passada. O workflow de publicação
repetirá esse salto a partir de `previous_mcp_tag`.

Falta CI obrigatório da PR (`verify`, `invariants`, `imagens-ok`, `e2e`) na
árvore 1.47. Antes de publicar, o workflow ainda repete typecheck, lint,
catálogo/policy/scopes/capabilities, autorização, isolamento entre organizações,
segredos, rate limit, saneamento de erros e request IDs, fluxos sentinela,
baseline install/reapply, shell/updater e build. Só depois de todos verdes
`RELEASE-AUDIT.json` poderá registrar o SHA oficial, `previous_mcp_tag`,
`mcp_compatible=true` e `gaps_a=0`. Quatro imagens e digests anônimos devem
existir antes do manifesto. A VPS permanece no canal MCP e só atualiza com
clique humano no painel.
