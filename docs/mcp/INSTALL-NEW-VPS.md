# Instalação em nova VPS — distribuição DeskcommCRM + MCP

Em uma VPS Linux **x86_64/amd64** nova, clone a linha estável do fork e execute
o instalador interativo existente:

```bash
git clone --branch mcp/stable https://github.com/lucascruzfl/DeskcommCRM.git
cd DeskcommCRM
bash hostgator-setup-kit/install.sh
```

O `hostgator-setup-kit/install.sh` continua guiando a instalação. Ele explica
onde obter o domínio, as credenciais do Supabase, a chave opcional de IA e os
dados da conta inicial, valida as respostas e retoma uma instalação interrompida.
Se Docker estiver ausente, pergunta antes de instalá-lo. Tenha acesso às portas
80/443 ou ao proxy reverso já presente na VPS. O nome do kit vem da parceria
upstream; Hostinger, HostGator, Hetzner, Contabo, DigitalOcean, AWS e outros
provedores de VPS Linux compatível usam o mesmo fluxo.

Esta distribuição ativa `custom-mcp` automaticamente. O instalador seleciona a
última release `vX.Y.Z-mcp` validada, confere manifesto e quatro imagens públicas
no GHCR e grava os digests no `.env`. A imagem do voice-agent fica preparada
para quando o perfil de telefonia for ativado. A instalação para se não houver
release MCP válida ou se as imagens não puderem ser puxadas. Não há build local
nem troca silenciosa para a distribuição oficial. O painel só oferece futuras
releases MCP validadas; uma versão oficial isolada não substitui esta instalação.

Para um agente Codex ou Claude Code em uma VPS limpa: peça para clonar a linha
`mcp/stable`, rodar **esse mesmo instalador**, acompanhar suas perguntas e pedir
apenas os dados que ele solicitar. Não é preciso escolher canal, imagem, digest,
token do GHCR ou manifesto.

Depois, confira a instalação com:

```bash
bash hostgator-setup-kit/healthcheck.sh
```

O fluxo de publicação e atualização está em [MCP-UPDATE-CHANNEL.md](MCP-UPDATE-CHANNEL.md).
