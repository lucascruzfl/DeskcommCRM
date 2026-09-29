---
name: deskcomm-cliente-novo
description: 'Guia para montar um cliente novo no DeskcommCRM por nicho — clínica, imobiliária, serviços/agência, curso/infoproduto, loja, escritório de advocacia, provedor de internet — incluindo clientes gerenciados e criando agentes de IA, roteadores, follow-ups, base de conhecimento, memória e funil, na ordem certa, pela tela ou pelas ferramentas MCP autorizadas existentes. Use SEMPRE que alguém quiser configurar o CRM para um cliente, criar o agente da clínica, montar o atendimento, pedir um prompt, configurar roteador/follow-up, subir a base de conhecimento, ou terminou o onboarding e pergunta e agora — inclusive agências implantando para terceiros. Faz a triagem, monta o pacote do nicho como texto pronto para colar e conduz tela a tela até o teste.'
metadata:
  publico: leigo, agência, implantador
  ponto-de-partida: criação gerenciada ou configuração após o onboarding
---

# Montar um cliente novo, por nicho

Este guia monta a operação por nicho depois do onboarding e também orienta a criação de
**cliente gerenciado** (managed client) pela agência. O onboarding gerenciado provisiona a
organização, a política de áreas, o membership do gestor e o convite oficial. Para ISP, o
onboarding também aplica o pacote operacional. A tool `crm_configure_managed_internet_provider`,
com token vinculado ao provedor alvo, permanece para preflight, retry e reparo explícito.
A implantação continua com prompt, roteamento, follow-ups, conhecimento,
memória e capacidades revisados para o negócio.

O atendimento é **IA + humano**: a IA atende normalmente, abre caso/passa para atendimento humano
quando precisa de uma pessoa ou não consegue resolver, e o humano pode assumir no Inbox. Combine
quem recebe, o próximo passo e quando devolver à IA; não prometa resolução automática de tudo.

## Como você age

- **Triagem antes de qualquer configuração.** Você não sabe o negócio da pessoa; ela sabe. Uma
  pergunta por vez, do que o sistema exige (`references/triagem.md`).
- **Monta o pacote como texto e usa os caminhos oficiais.** Pela tela, siga
  `references/pela-tela.md`; para MCP, confira as ferramentas e limites em
  `references/por-arquivo.md`. Há configuração via MCP, mas nem toda configuração tem tool.
  Não configure por SQL: isso pula validação, auditoria e eventos; o agente usa a versão publicada.
- **Cliente gerenciado tem permissões próprias.** Leia `references/cliente-gerenciado.md` antes
  de criar ou administrar um. Preset de áreas não concede acesso universal; o onboarding ISP
  aplica o pacote operacional no mesmo tenant.
- **Não inventa regra de negócio.** Preço, prazo, política de cancelamento, horário: vêm da
  pessoa ou dos documentos dela. O que não está escrito vira pergunta, não suposição.
- **Não repete no prompt o que o motor já impõe.** Apresentar-se como assistente, não inventar
  preço, respeitar STOP, horário de envio, promessa sem caso aberto — tudo isso é portão mecânico
  (`references/prompt-do-agente.md`). Prompt que repete gasta contexto e vaza vocabulário.
- **Publicar requer decisão da pessoa.** Deixe em rascunho e mostre o teste pelo botão Testar
  ou pela tool de prévia autorizada. Publique só após autorização explícita; publicação e
  ativação via MCP têm capabilities distintas. Não repita a aprovação se ela já foi dada no
  escopo desta implantação.

## Passo 0 — onde a pessoa está

Pergunte, uma por vez: a instalação já está no ar e o onboarding terminou (nome do negócio,
WhatsApp conectado, atendente básico, funil)? É para o próprio negócio ou para um cliente da
agência? A organização já existe ou é preciso criar um cliente gerenciado? Qual o nicho —
clínica/consultório, imobiliária, serviços/agência/obra, curso/mentoria/infoproduto, loja, escritório de advocacia ou
**provedor de internet (ISP)**?

Sem instalação: guia `deskcomm-instalar`. Criação gerenciada: siga
`references/cliente-gerenciado.md`, com os presets `managed/aesthetic-clinic` e
`managed/internet-provider`; só platform_admin ativo com scope full cria. Depois o gestor usa o
membership oficial e o organization switcher para terminar a implantação. Sem WhatsApp conectado,
o agente de WhatsApp não publica: precisa do número WORKING. Outro nicho: pacote genérico adaptado com a triagem.

## Passo 1 — a triagem

`references/triagem.md` lista tudo que o sistema exige e por quê, agrupado: o negócio (nome, o
que faz, fuso), o canal (qual número, horário de atendimento), a IA (provedor, chave da OpenAI
para áudio e base de conhecimento), o funil (etapas com uma "ganhou" e uma "perdeu", vocabulário),
os agentes (um ou vários? tom, o que pode prometer, quando passa para humano), o roteador (só
com dois ou mais agentes no mesmo número), os follow-ups (silêncio, no-show, abandono), o
conhecimento (FAQ, documentos, catálogo), a memória (regras da casa), as promessas (piso de preço,
desconto, parcelas), as automações e o time.

Registre o plano num arquivo `pacote-<cliente>.md` na pasta indicada. Mantenha prompts,
conteúdo aprovado e pendências; não grave credenciais, tokens, dados pessoais de clientes ou URLs
privadas. Os exemplos deste guia são fictícios e os campos entre chaves exigem preenchimento.

## Passo 2 — monte o pacote do nicho

Parta do pacote pronto do nicho em `references/nichos.md` (funil, vocabulário, esqueleto de prompt,
intenções do roteador, follow-ups, perguntas de FAQ, itens de memória, capacidades) e preencha
com a triagem. O prompt segue a anatomia de `references/prompt-do-agente.md`: identidade, o que o
negócio faz, diagnóstico antes da oferta, qualificação, situações e o que dizer em cada uma,
limites, estilo, quando chamar uma pessoa. Nada de nomear ferramenta, nada de "encaminhe ao
gerente Fulano" para tudo que não souber — isso faz o modelo parar de usar a agenda.

## Passo 3 — configure pelas superfícies oficiais, nesta ordem

Resolva as dependências antes de publicar. Os nomes e caminhos atuais estão em
`references/pela-tela.md`; o equivalente MCP comprovado, quando houver, em
`references/por-arquivo.md`. No tenant managed, a agência com membership admin configura as áreas
  agency; a pessoa do cliente convidada como agent opera as áreas permitidas.

1. **Conexões** — o número precisa estar WORKING (o onboarding já fez).
2. **IA › Credenciais** — a credencial validada do provedor, ou a chave resolvida pela instalação
   quando permitido; confira também a chave da OpenAI para áudio e indexação de conhecimento.
3. **IA › Provedores** — o modelo dos auxiliares (classificador do roteador, follow-up) num modelo
   barato; o do atendimento num modelo que usa ferramentas.
4. **Funil** — etapas do pacote, uma "ganhou" e uma "perdeu" (fechamentos ISP como motivos), o mapa dos
   7 passos do agente (novo, contatado, qualificando, qualificado, negociando, ganhou, perdeu), vocabulário.
5. **IA › Conhecimento** — FAQ (pares pergunta/resposta) e documentos (PDF/MD/TXT/CSV até 20 MB);
   a indexação é assíncrona e precisa da chave de embeddings resolvida — confira a indexação concluída.
6. **IA › Follow-ups** — crie, monte o fluxo (gatilho → espera → mensagem → condição → fim),
   publique. Fluxo não publicado não roda.
7. **IA › Agentes** — um agente por papel: prompt, provedor/modelo/credencial, canal, funis que
   ele pode mover, fontes de conhecimento, follow-ups que arma, capacidades (pacotes; as críticas
   uma a uma), palavras de passagem para humano, casos. Salve como rascunho.
8. **Testar** — o botão ou `crm_test_ai_agent_version` roda a prévia controlada com uma mensagem:
   veja o texto e as ações propostas. Isso não prova envio, roteamento ou handoff real. Roteiro do nicho em
   `references/nichos.md`.
9. **Publicar** — pela pessoa ou via MCP expressamente autorizado; confirme também a ativação.
   Só depois: **IA › Roteadores** (dois ou mais agentes no mesmo número: intenções com descrição,
   exemplos e fallback), **IA › Memória** (regras da casa),
   **IA › Skills** (instalar `agendamento` e `objecao-preco` se for personalizar), automações,
   convites do time. Para ISP, agenda/calendário fica OFF inicialmente: não instale `agendamento`
   nem selecione capacidades de agenda. Reveja o pacote *vender*, que inclui agenda; selecione
   apenas capacidades permitidas para ISP. Financeiro do CRM não consulta fatura de assinante.

## Passo 4 — entregue

Checklist final, medido na tela: agente publicado com o número certo; roteador ativo com todos
os membros publicados; follow-ups ativos e ligados ao agente; indexação dos materiais concluída;
memória revisada (documento publicado quando usado); roteiro do nicho respondido como esperado;
passagem e tomada por humano verificadas no Inbox; a pessoa sabe onde muda cada coisa.
No ISP, confirme calendário OFF, preservação de contatos sem cobertura e ausência de cobrança
fictícia. Em managed, prove também o acesso do gestor e do cliente pelo seletor de organização.
Se algo ficou de fora (sem chave da OpenAI, sem documentos), escreva no `pacote-<cliente>.md` o que falta e
o que acontece enquanto falta — não deixe a lacuna invisível.

## O que você nunca faz

- Não configura por SQL, não cria impersonation nem supertoken cross-tenant.
- Não anuncia cobertura, consulta de fatura, PIX, pagamento ou desbloqueio de ISP sem integração
  real. PIX nunca é estático ou inventado.
- Não publica versão de agente sem a pessoa ver o teste e mandar publicar.
- Não põe preço, prazo ou política no prompt se existe catálogo ou base de conhecimento para isso
  — duas fontes de verdade divergem.
- Não cola vocabulário interno no prompt (nome de ferramenta, "lead_id", "etapa qualified"): o
  motor veta resposta com jargão, e o prompt vira a origem do veto.
- Não instala uma skill do produto ou liga uma capacidade "crítica" (enviar mensagem avulsa,
  cancelar agenda, fechar caso) sem dizer o que ela permite ao agente fazer sozinho.
