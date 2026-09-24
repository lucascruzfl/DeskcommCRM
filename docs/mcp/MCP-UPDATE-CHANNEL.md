# Contrato do canal de atualização MCP

O fluxo é upstream oficial → fork integrado → auditoria delta → testes → quatro
imagens GHCR do fork → manifesto de release → botão do painel → produção. O
release do fork contém código oficial e extensões MCP no mesmo commit. O canal
`official` permanece o padrão do produto upstream; clones da linha `mcp/stable`
ativam `custom-mcp` automaticamente na instalação nova.

`DESKCOMM_UPDATE_REPOSITORY` aponta para `owner/repo` no GitHub, de onde vêm
tags e o asset `releases/download/vX.Y.Z-mcp/mcp-release.json`.
`DESKCOMM_IMAGE_REPOSITORY` aponta para o repositório do app no GHCR; worker,
scheduler e voice-agent usam o mesmo namespace. Manifesto e imagens precisam
ser públicos para o instalador e o agente de uma VPS sem PAT conseguirem
consultá-los. A publicação usa `GITHUB_TOKEN` efêmero do Actions com
`packages: write` e `contents: write`; nenhuma credencial entra no Git.
O workflow liga as imagens ao repositório público pelo label OCI `source`.
Se um pacote GHCR já existente estiver privado, ajuste sua visibilidade na
configuração do pacote antes da primeira release; o canal recusará digests que
não puder consultar anonimamente.

O manifesto tem `schema_version`, `deskcomm_version`, `tag`, `mcp_commit`,
`tests: passed`, `gaps_a: 0`, `tool_count_snapshot` e quatro entradas em
`images`, cada uma com `repository`, `tag` e `digest`. O validador exige
igualdade do SHA da tag e dos nomes esperados e verifica o formato dos digests.
O agente confirma que os quatro digests existem no registry. O número de tools
é um snapshot informativo; `tools/list` é a fonte de verdade.
O workflow também testa a leitura dos quatro digests sem credenciais antes de
publicar o asset; pacote privado não vira release pronta.

Tags MCP são versões fixas (`1.42.0-mcp`, `1.43.0-mcp`). O pipeline não move
`latest-mcp`, evitando mistura de app e worker enquanto as imagens publicam.
O asset nasce somente depois que os quatro pushes completam. Uma release
incompleta fica invisível ao botão. O atualizador ainda repete a validação
antes de tocar a instalação e grava digests, inclusive para rollback.

O código antigo em uma VPS que ainda executa o atualizador oficial não recebe
essa proteção retroativamente. A migração de uma VPS **já instalada** exige deploy
autorizado do fork e persistência das três chaves no `.env`. Depois disso, o
botão passa a usar o canal MCP e não escolhe a imagem upstream.
Se a chave do canal for removida por engano, o checkout/tag e o `APP_VERSION`
da imagem MCP ainda bloqueiam o caminho oficial até a configuração ser
restaurada.

A detecção de upstream usa release/tag oficial; `main` do fork é apenas espelho
visual. O workflow de corte oficial está desativado especificamente no fork.
Sync fork na `main` não publica MCP e não atualiza a VPS. O canal só oferece
release com manifesto e quatro digests validados; falha ou versão oficial sem
MCP nunca provoca fallback. A pessoa ainda clica **Atualizar** no painel.
