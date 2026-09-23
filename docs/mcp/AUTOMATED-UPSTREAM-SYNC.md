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
classificação A/B/C exige revisão humana quando a semântica mudou. Ao integrar o PR revisado em `mcp/stable`, o workflow dessa branch confere
a versão/a SHA oficiais, executa os gates, cria a tag, publica as quatro imagens
e só então o manifesto. A release MCP continua fechada enquanto `RELEASE-AUDIT.json` não identificar a versão e
`gaps_a=0` com compatibilidade confirmada. O workflow de publicação repete os
gates e só publica `mcp-release.json` depois das quatro imagens e digests.

Uma release oficial sem `-mcp`, teste falho, conflito, imagem ou manifesto
inválido não aparece no canal. A VPS nunca usa imagem oficial como fallback.
A produção só muda depois do clique humano no painel.

Situação 1.45.0: [AUDIT-1.45.0.md](AUDIT-1.45.0.md) contém os cinco conflitos
e a triagem pendente. Ainda não é release MCP pronta.
