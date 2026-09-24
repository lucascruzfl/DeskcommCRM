# Releases oficiais → canal MCP

```text
UPSTREAM publica tag/release
→ AUTO DETECT (schedule ou execução manual no fork)
→ branch de integração isolada sobre mcp/stable
→ delta audit e PR; conflitos viram issue e bloqueiam
→ revisão A/B/C + gates MCP
→ release vX.Y.Z-mcp com quatro imagens e manifesto por último
→ PAINEL detecta release pronta
→ CLIQUE HUMANO em Atualizar
→ VPS atualiza por digest
```

`main` do fork pode receber **Sync fork** para acompanhar o upstream visualmente.
Esse clique não muda a produção nem publica MCP. O pipeline busca diretamente a
tag da release oficial; Sync fork manual não é requisito. O workflow oficial
`release.yml` foi desativado **apenas no fork** via GitHub Actions (estado
`disabled_manually`), porque é herdado do upstream e requer o GitHub App de
corte de release oficial. Assim, push e Sync fork não executam esse workflow.
Não reative sem revisar a identidade do repositório e as credenciais.

O detector gera `mcp-delta-report.md` como artefato. Um merge limpo abre PR para
`mcp/stable`; conflito abre issue com arquivos e interrompe a tentativa. A
execução seguinte reconhece a branch/PR existente e não duplica a solicitação.
Se a tag oficial já estiver integrada em `mcp/stable`, o detector informa que a
auditoria ou os gates ainda bloqueiam a release, sem abrir outra PR.
A lista do delta distingue endpoints criados/alterados, contratos, policy,
workers, migrations e updater por caminho; a interpretação permanece na PR.
A configuração do fork permite que GitHub Actions crie PRs, mantendo a permissão
padrão do `GITHUB_TOKEN` em `read`; somente o workflow detector recebe
`contents`, `pull-requests` e `issues` como `write`. A classificação A/B/C exige
revisão humana quando a semântica mudou. Ao integrar o PR revisado em `mcp/stable`, o workflow dessa branch confere
a versão/a SHA oficiais, executa os gates, publica as quatro imagens, valida os
digests, cria a tag e anexa o manifesto a uma release em rascunho. Só então a
release fica pública. A release MCP continua fechada enquanto `RELEASE-AUDIT.json` não identificar a versão e
`gaps_a=0` com compatibilidade confirmada. O workflow de publicação repete os
gates e só publica `mcp-release.json` depois das quatro imagens e digests.

A branch `mcp/stable` está protegida no fork: exige PR atualizado e checks
`verify`, `invariants`, `imagens-ok` e `e2e` verdes; administradores também
seguem a regra, e force push e exclusão estão bloqueados. O workflow de
publicação repete typecheck, lint, testes unitários, instalação/reaplicação do
baseline, invariantes de banco, shell/updater e build antes de publicar.

Uma release oficial sem `-mcp`, teste falho, conflito, imagem ou manifesto
inválido não aparece no canal. A VPS nunca usa imagem oficial como fallback.
A produção só muda depois do clique humano no painel.

Situação 1.45.0: [AUDIT-1.45.0.md](AUDIT-1.45.0.md) contém os cinco conflitos
e a triagem pendente. Ainda não é release MCP pronta.
