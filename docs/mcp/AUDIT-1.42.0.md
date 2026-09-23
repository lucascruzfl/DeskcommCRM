# Auditoria diferencial: DeskcommCRM 1.42.0 + MCP

Base MCP completa: `feat/mcp-full-control` em `c16eb8601` (o commit
`b69af8872` foi a implantação histórica, seguida por documentação). Upstream:
`v1.42.0` em `e47387a09`; merge-base `3538380b`. Integração na branch
`feat/mcp-update-channel-1.42`. O merge foi feito em worktree separado; a
branch de responsividade e seu patch foram preservados fora dele. Depois da
validação MCP, os 60 arquivos do patch foram integrados; o único conflito de
conteúdo, no formulário de tokens, preservou o preset MCP e a rolagem do modal.

## Deltas que tocam o contrato

| Área | Delta 1.42.0 | Tratamento MCP |
| --- | --- | --- |
| Borda e auth | Limite para falhas de token na rota MCP | Mantido junto ao teto HTTP e de escrita do Full Control; uma chamada não debita duas vezes. |
| Registry e módulos | Módulos opcionais agora filtram capacidades | O filtro também limita `tools/list` e o catálogo exposto. |
| Services | Dados externos ganharam descrição e consulta | Os handlers MCP upstream foram incorporados; a contagem derivada cresceu em duas tools. |
| Campanhas | Novo domínio, máquina de estados, schemas, pool, destinatários, templates, exclusões e padrões | Tools MCP usam os mesmos schemas e services, sempre com `organization_id` do contexto. Início, agendamento e teste de envio dependem de confirmação humana pela tela; a tool de lançamento apenas encaminha a ação. |
| Banco | Upstream adicionou migration `_0382_` enquanto o MCP já tinha uma 0382 distinta | A migration MCP implantada mantém `0382`; a migration oficial de link salvo foi renumerada no fork para `20260923004404_0385_link_salvo_no_modelo.sql`, sem alterar o SQL. Baseline e MANIFEST incluem ambas. |
| Atualização | Canal upstream usa tag e imagem oficiais | Canal `custom-mcp` exige manifesto e quatro digests do fork antes de anunciar ou executar a atualização. |

O `tools/list` do registry integrado tem 226 entradas no snapshot desta
auditoria. A contagem anterior de 202 e a de 226 são diagnósticos; nenhuma é
requisito de compatibilidade. O preset **Operação completa via MCP** continua
derivado dos domínios e capabilities, incluindo `campaigns`.

## Portas de validação

- `pnpm typecheck`, sentinelas MCP, catálogo/policy/scopes/capabilities e
  fluxos compostos.
- `pnpm test:db` com baseline install/update e invariantes de tenant/FAQ.
- `pnpm test:shell`, incluindo 1.43.0 oficial sem release MCP, manifesto
  inválido e manifesto validado.
- Build das quatro imagens pelo workflow, antes da publicação do manifesto.

O manifesto público só aparece após todos os gates e digests existirem no
GHCR. Esta auditoria não autoriza a troca da produção; a ativação inicial do
canal e o deploy permanecem etapas separadas de revisão.
