# Atualizar DeskcommCRM com MCP Full Control

Uma instalação MCP usa código integrado e imagens do fork. A imagem oficial
`ghcr.io/melgarafael/deskcommcrm` não inclui as extensões MCP e não deve ser alvo
do botão nessa instalação. Não se instala a oficial para reaplicar patches.

## Canal da instalação

Depois de publicar uma release MCP validada, fixe no `.env` da VPS:

```dotenv
DESKCOMM_UPDATE_CHANNEL=custom-mcp
DESKCOMM_UPDATE_REPOSITORY=lucascruzfl/DeskcommCRM
DESKCOMM_IMAGE_REPOSITORY=ghcr.io/lucascruzfl/deskcommcrm
```

Os três valores são explícitos e não contêm credenciais. O canal `official` é o
default para qualquer instalação sem essas chaves. O canal customizado exige
as três; configuração incompleta recusa a atualização. O checkout da instalação
precisa ser o fork que contém `mcp-channel.sh`; o atualizador antigo em produção
não conhece o canal. A ativação inicial é uma etapa de deploy separada, após
revisão, backup e publicação de `v1.42.0-mcp`.
Se a chave do canal sumir de um checkout MCP, o agente e o `update.sh` reconhecem
a tag MCP no histórico e recusam o caminho oficial. A API também reconhece o
`APP_VERSION` da imagem MCP e esconde uma tag oficial antiga no banco.

O agente do painel consulta somente tags `vX.Y.Z-mcp` do repositório configurado.
Uma tag só é anunciada depois de encontrar o asset `mcp-release.json`, validar
versão, SHA, testes, gaps A e quatro digests e conferir as imagens no GHCR. O
`update.sh` repete essa checagem antes de backup, checkout, banco ou containers.
Ele grava os digests em `APP_IMAGE`, `WORKER_IMAGE`, `SCHEDULER_IMAGE` e
`VOICE_AGENT_IMAGE`. Nenhum `latest` ou `stable` customizado decide o deploy.

O botão continua criando um `system_update_run`; o agente do host executa o
mesmo `update.sh` e reporta progresso/desfecho. Se upstream publicar 1.43.0
antes de `v1.43.0-mcp` passar pelos gates, a maior release pronta continua
1.42.0-mcp: o painel espera e não oferece a imagem oficial. Mesmo `--to` e
`--force` não ignoram o manifesto no canal MCP.

## Produzir a próxima release

1. A branch `mcp/stable` preserva a última MCP pronta. O workflow de detecção
   consulta a última release oficial, busca a tag sem depender de Sync fork e
   prepara `mcp/integrate/X.Y.Z` a partir da linha estável.
2. Execute [AUDIT-NEW-VERSION.md](AUDIT-NEW-VERSION.md), classifique os deltas
   A/B/C e ajuste apenas contratos que mudaram. A integração 1.42.0 está
   registrada em [AUDIT-1.42.0.md](AUDIT-1.42.0.md).
3. Rode sentinelas MCP, banco focado, typecheck, lint, `test:shell` e build.
   Atualize `docs/mcp/RELEASE-AUDIT.json` somente quando gaps A forem zero.
4. Depois de revisar o PR de integração e confirmar `gaps_a=0` em
   `RELEASE-AUDIT.json` para a versão e SHA oficiais, faça merge em
   `mcp/stable`. O workflow dessa branch repete todos os gates, constrói as
   quatro imagens, valida seus digests, cria a tag `vX.Y.Z-mcp` e publica a
   release com o manifesto somente ao final.
5. O agente da VPS passa a oferecer a nova versão no próximo ciclo. Revise a
   tela e use **Atualizar agora**. Não há etapa de reaplicação manual do MCP.

O workflow de publicação está preparado, mas esta documentação não publica
nenhuma imagem ou manifesto por si só. O arquivo `RELEASE-MANIFEST.json` antigo
é histórico da Skill; o asset `mcp-release.json` gerado pelo workflow é o
contrato machine-readable do canal.

## Saúde e rollback

O `update.sh` preserva backup e a lógica de rollback do agente oficial. No
canal MCP, ele exige app saudável, baseline sem erro, worker e scheduler em
execução e resposta JSON-RPC/401 da borda MCP sem credencial. Isso confirma que
a rota e o guard estão vivos sem guardar token administrativo no servidor.
Handshake autenticado e `tools/list` exigem um token criado na tela por uma
pessoa autorizada; rode a verificação da Skill após a atualização. A contagem
retornada é diagnóstico, nunca trava fixa.

Se o app novo falhar, o agente restaura os IDs locais anteriores de app,
worker e scheduler e grava esses IDs no `.env`. O manifesto mantém os digests
do release anterior para uma reinstalação controlada: `update.sh --to
vX.Y.Z-mcp --force` continua sujeito ao gate do canal. O banco pode já ter
migrations aditivas; confira o relatório e o backup antes de qualquer reversão
de dados.

Veja [AUTOMATED-UPSTREAM-SYNC.md](AUTOMATED-UPSTREAM-SYNC.md) para o fluxo automático, bloqueios e papel humano.
