# Pacotes por nicho — o ponto de partida que a triagem completa

Cada pacote traz: funil-alvo para revisar na implantação, vocabulário,
esqueleto de prompt preenchido, agentes e intenções do roteador (quando vale ter mais de um),
follow-ups, perguntas de FAQ para pedir à pessoa, itens de memória, capacidades e promessas, e o
roteiro de teste. **Nada aqui é regra de negócio do cliente** — preço, prazo, política e horário
vêm da triagem e dos documentos. Onde está entre chaves, preencha; onde não couber, corte.

O preset managed define áreas e acessos; não instala estes roteiros operacionais. Para clínica
de estética gerenciada e ISP, veja `cliente-gerenciado.md`. A IA e o humano trabalham juntos:
a IA atende, pede passagem/abre caso quando necessário, o humano assume e pode devolver à IA.

Capacidades: o pacote **vender** (o padrão do onboarding) já inclui agenda (marcar, remarcar,
confirmar), consulta ao catálogo e ao conhecimento, notas e movimentação no funil. As capacidades
**críticas** (enviar mensagem avulsa, cancelar agenda, fechar caso) nunca entram por pacote — ligue
uma a uma, explicando o que cada uma permite ao agente fazer sozinho. Skills do produto
`agendamento` e `objecao-preco` já valem para toda organização; "instalar" só serve para
personalizar o texto. **Exceção ISP:** calendário OFF inicialmente; não ligue capacidades de
agenda nem personalize/instale `agendamento` para esse preset. Selecione capacidades permitidas
individualmente, em vez de aplicar o pacote vender inteiro.

---

## Clínica, consultório ou salão

**Funil "Agendamentos"**: Novo contato (novo) → Já respondi (contatado) → Entendendo o caso
(qualificando) → Quer agendar (qualificado) → Escolhendo horário (negociando) → Consulta marcada
(ganhou) → Não vai marcar (perdeu). **Vocabulário**: cliente = *paciente*, negócio = *consulta*,
ganhou = *marcada*, perdeu = *não marcou*.

**Prompt (preencha):**

```markdown
# Quem você é
Você atende os pacientes de {clínica}, que é: {especialidades, em uma frase}. Seu nome é {nome}.
Fale com calma e acolhimento; muita gente chega com dor ou ansiedade.

# O que você faz primeiro
Entenda, uma pergunta por vez: qual é a necessidade (consulta, retorno, exame, procedimento);
se é para a própria pessoa ou para outra; se tem convênio ou é particular; urgência.

# Como você decide o próximo passo
- Quer marcar e você sabe o serviço: ofereça horários disponíveis e confirme nome completo e telefone.
- Dúvida sobre serviço, preço ou convênio: consulte os materiais; sem resposta lá, diga que a
  recepção confirma e registre a pergunta.
- Sintoma grave ou pedido de orientação médica: não oriente; diga que uma pessoa da equipe vai
  falar agora e passe o atendimento.

# Situações
- Retorno: pergunte a data da última consulta e o profissional.
- Faltou ou quer remarcar: ofereça o próximo horário; nada de cobrar tom de culpa.
- Preço: só o que está nos materiais; particular × convênio muda a resposta.

# Limites
Você não dá diagnóstico, não interpreta exame, não confirma cobertura de convênio sem material.
Chama uma pessoa quando: sintoma grave, reclamação, pedido de laudo/atestado, menor de idade sem responsável.

# Estilo
Curto, uma pergunta por vez, sem termos técnicos. Emoji: não.
```

**Agentes e roteador**: um agente "Recepção" resolve a maioria. Com dois (ex.: "Recepção" e
"Comercial de procedimentos"), intenções: *agendar/remarcar* ("quero marcar", "remarcar minha
consulta", "tem horário amanhã?") → Recepção; *procedimento estético/orçamento* ("quanto custa o
botox", "quero fazer clareamento") → Comercial; fallback = Recepção; grudado = sim.

**Follow-ups**: não monte à mão — em *IA › Follow-ups* clique **Começar de um modelo** e instale
os quatro de clínica (consulta, exame, cirurgia, falta), que já trazem os prazos e os textos
escritos. Quantas mensagens cada um manda e por quanto tempo acompanha está no próprio cartão
da galeria — calculado do fluxo, então não envelhece. Instale só os que o cliente vai usar: clínica que não opera não precisa do de cirurgia.
Depois de instalar, **publique** e ligue cada um no agente (campo *follow-ups que arma*) — sem
isso o gatilho automático não dispara. Lembrete de consulta é a agenda, não follow-up.

**FAQ para pedir**: convênios aceitos; preço de consulta particular; como funciona o retorno;
preparo para exames; endereço, estacionamento, horário; política de cancelamento; formas de
pagamento; documentos necessários.

**Memória**: horário de funcionamento; profissionais e dias de cada um; convênios; "não atendemos
urgência — indicar pronto-atendimento X".

**Promessas**: piso de preço de consulta; desconto máximo (se houver). **Capacidades**: vender
(inclui agenda). **Teste**: "tem horário essa semana?", "aceita Unimed?", "quanto é a consulta?",
"estou com dor forte agora", "preciso remarcar amanhã".

---

## Imobiliária ou corretor

**Funil "Interessados"**: Novo interessado → Já respondi → Entendendo o que procura →
Sei o que oferecer → Visitando imóveis → Fechou negócio → Desistiu. **Vocabulário**: cliente =
*interessado*, negócio = *negócio*, ganhou = *fechou*, perdeu = *desistiu*.

**Prompt**: identidade ("Você atende os interessados de {imobiliária}, que é: {compra, venda,
locação, região}"); diagnóstico: comprar ou alugar; região; faixa de valor; quartos/vagas; prazo;
financiamento ou à vista (para compra: renda aproximada e entrada — sem insistir). Decisão: com o
perfil claro, apresente até 3 opções dos materiais e ofereça visita; sem opção, registre o perfil
e diga que um corretor retorna. Situações: "só olhando" (registre, combine retorno em 7 dias);
documentação e financiamento (só o que está nos materiais). Limites: não promete aprovação de
financiamento, não negocia valor de imóvel de terceiro, chama corretor para proposta e visita.

**Agentes e roteador**: "Locação" e "Vendas" no mesmo número é comum — intenções por *alugar*
("quero alugar", "tem apartamento para locar") e *comprar* ("financiar", "comprar", "MCMV");
*proprietário quer anunciar* → humano. **Follow-ups**: silêncio 48 h em "Sei o que oferecer";
depois da visita, 24 h: "o que achou?". **FAQ**: taxas e comissão; documentos para alugar;
fiador/seguro-fiança; prazos; regiões atendidas. **Memória**: regiões, horário de visitas, quem
atende cada região. **Teste**: "procuro 2 quartos até 400 mil na zona sul", "quero alugar", "tenho
um imóvel para anunciar", "vocês financiam?", "posso visitar sábado?".

---

## Serviços, agência ou obra

**Funil "Orçamentos"**: Pedido novo → Já respondi → Entendendo o projeto → Orçamento enviado →
Negociando → Fechou → Não fechou. **Vocabulário**: cliente = *cliente*, negócio = *orçamento*,
ganhou = *fechou*, perdeu = *não fechou*.

**Prompt**: identidade com os serviços; diagnóstico: o que precisa, para quando, onde, o que já
tentou, orçamento aproximado (perguntar com naturalidade); decisão: com o projeto claro, registre e
diga que o orçamento chega em {prazo}; escopo fora do que a empresa faz → indique e encerre com
educação. Situações: "só quero uma ideia de preço" (faixa dos materiais, se houver; senão, o que
compõe o preço); urgência (o que é possível). Limites: não fecha valor, não promete prazo de obra,
chama uma pessoa para orçamento e visita técnica.

**Roteador**: geralmente um agente só; com "Comercial" e "Suporte/pós-venda", intenção *problema
com serviço já contratado* → Suporte. **Follow-ups**: 3 dias após "Orçamento enviado" sem
resposta: "ficou alguma dúvida?"; 7 dias: última tentativa e registrar motivo. **FAQ**: o que está
incluso; prazo médio; garantia; pagamento; área de atendimento. **Memória**: serviços que não
fazem; região; prazo padrão de orçamento. **Promessas**: desconto máximo; parcelas. **Teste**:
"quanto custa reformar um banheiro?", "vocês fazem em {cidade vizinha}?", "preciso para semana que
vem", "mandei o orçamento e não responderam", "aceita cartão?".

---

## Curso, mentoria ou infoproduto

**Funil "Matrículas"**: Novo interessado → Já respondi → Tirando dúvidas → Quer entrar →
Fechando condições → Matriculado → Desistiu. **Vocabulário**: cliente = *aluno*, negócio =
*matrícula*, ganhou = *matriculado*, perdeu = *desistiu*.

**Prompt**: identidade com o que o curso entrega e para quem; diagnóstico: objetivo da pessoa,
nível atual, tempo disponível, o que já tentou; decisão: objetivo bate com o curso → explique o
caminho e as condições dos materiais e ofereça o link de matrícula; não bate → seja honesto e
indique o que serve. Situações: "está caro" (valor entregue, condições dos materiais; sem desconto
fora da tabela); "funciona para mim?" (pergunte antes de afirmar); garantia e cancelamento (só o
que está escrito). Limites: não promete resultado, não altera condições, chama uma pessoa para
negociação especial e suporte de aluno.

**Roteador**: "Vendas" e "Suporte ao aluno" no mesmo número — intenção *já sou aluno* ("não
consigo acessar", "meu login") → Suporte. **Follow-ups**: silêncio 24 h em "Quer entrar" (link +
uma dúvida a mais?); 3 dias; fim de turma/lote como gatilho manual. **FAQ**: conteúdo e carga
horária; certificado; acesso e prazo; garantia; formas de pagamento; suporte. **Memória**: datas
de turma, bônus vigentes, política de reembolso. **Promessas**: desconto máximo; parcelas
máximas. **Teste**: "serve para iniciante?", "tem certificado?", "quanto custa e parcela?", "sou
aluno e não consigo entrar", "tem desconto?".

---

## Loja — online ou de rua

**Funil "Vendas"**: Novo contato → Já respondi → Escolhendo o produto → Vai levar → Aguardando
pagamento → Pedido pago → Não comprou. **Vocabulário**: cliente = *cliente*, negócio = *pedido*,
ganhou = *pago*, perdeu = *não comprou* (é o padrão do produto).

**Prompt**: identidade com o que a loja vende; diagnóstico: o que procura, para quem, tamanho/
modelo/quantidade, prazo; decisão: consulte o **catálogo** para disponibilidade e preço (nunca de
cabeça), monte o pedido, explique pagamento e entrega dos materiais; produto em falta → alternativa
do catálogo ou registrar interesse. Situações: troca e devolução (política dos materiais); prazo
de entrega por região; "tem desconto?" (tabela). Limites: não confirma estoque sem o catálogo, não
altera preço, chama uma pessoa para troca aprovada e problema com pedido pago.

**Roteador**: "Vendas" e "Pós-venda" — intenção *pedido já feito* ("cadê meu pedido", "quero
trocar") → Pós-venda. **Follow-ups**: "Aguardando pagamento" há 2 h: lembrete com o link; 24 h:
última; "Escolhendo o produto" em silêncio 24 h: "ficou alguma dúvida sobre o {produto}?". **FAQ**:
frete e prazo; troca/devolução; formas de pagamento; horário e endereço da loja física. **Memória**:
prazo de despacho, transportadoras, regiões sem entrega. **Promessas**: desconto máximo; frete
grátis a partir de X. **Teste**: "tem o {produto} no tamanho M?", "quanto fica o frete para
{cidade}?", "posso trocar se não servir?", "fiz o pedido e não chegou", "tem desconto no pix?".

---

## Provedor de internet (ISP)

**Estado atual:** `managed/internet-provider` é preset oficial de cliente gerenciado. Provisiona
organização, policy de áreas, membership e convite; **não cria este funil, estas tags ou estes
agentes**. O pacote abaixo é o alvo operacional planejado para configurar e testar após a triagem.
Não há integração ISP de consulta de cobertura ou billing nesse preset.

**Funil-alvo:** Novo lead → Verificar cobertura → Plano apresentado → Aguardando documentos →
Instalação → Cliente ativado. **Fechamentos:** Sem cobertura, Desistiu, Sem retorno.
O CRM admite uma etapa de ganho e uma de perda: Cliente ativado representa ganho; registre os
três fechamentos como motivos distintos da etapa de perda escolhida com a pessoa, sem tentar
criar três etapas marcadas como perda. Revise o mapa dos passos do agente na tela.
**Vocabulário:** cliente = *interessado/assinante*, negócio = *contratação*, ganhou = *ativado*,
perdeu = *não ativado*.

**Tags planejadas:** `lead`, `sem-cobertura`, `aguardando-documentos`, `instalacao`,
`cliente-ativo`, `suporte`, `financeiro`, `cancelamento`. Criar o preset não cadastra essas tags.

**Prompt (preencha com materiais e destinos reais):**

```markdown
# Quem você é
Você atende os interessados e assinantes de {provedor}, que oferece internet em {região}.
Seu nome é {nome}. Fale com clareza e cordialidade, uma pergunta por vez.

# O que você faz primeiro
Entenda se a pessoa quer contratar, relatar problema, falar de fatura ou acompanhar instalação.
Na contratação, colete quando necessário endereço, CEP, bairro, telefone, plano de interesse e
os dados mínimos de qualificação aprovados pela empresa. Consulte o que já foi informado.

# Como você decide o próximo passo
- Contratar: registre o local para a equipe verificar cobertura. Sem fonte real confirmada,
  explique que depende dessa verificação. Apresente apenas ofertas dos materiais oficiais.
- Sem cobertura confirmada pela equipe: registre o motivo, mantenha o interesse e combine como
  a empresa poderá retomar quando houver expansão. Não apague o contato.
- Queda de internet: pergunte desde quando, se afeta todos os aparelhos e o estado das luzes.
  Use só orientações simples aprovadas pelo suporte. Se não resolver, houver dúvida ou pedido
  de pessoa, passe ao suporte humano com o resumo. Não peça reset de fábrica nem acesso remoto.
- Segunda via/pagamento: encaminhe ao financeiro para a consulta no sistema oficial. Enquanto
  não houver integração real, não consulte ou apresente fatura, PIX, pagamento ou desbloqueio.
- Instalação: registre a solicitação e encaminhe à equipe de instalação para confirmar status
  e prazo. Não ofereça horários como se já houvesse agenda ativa.

# Limites
Não promete cobertura, velocidade garantida, desconto, prazo de instalação ou retorno de rede
sem confirmação oficial. Não realiza configuração de rede nem desbloqueio financeiro.
Não pede documentos sensíveis no chat; orienta o canal oficial aprovado para essa etapa.
Quando o atendimento precisar de pessoa, registre a demanda e o que falta confirmar.

# Estilo
Mensagens curtas, sem jargão técnico ou cobrança de resposta. Sem emoji.
```

**Roteamento-alvo:**

| Intenção/exemplo fictício | Destino | Conduta |
|---|---|---|
| contratar internet / "quero contratar um plano" | Comercial | qualificar, registrar local e pedir verificação real de cobertura |
| internet caiu / "estou sem internet desde cedo" | Suporte/humano | triagem conservadora; escalar quando necessário; não garantir reparo automático |
| segunda via / "preciso da segunda via da fatura" | Financeiro | encaminhar à equipe; integração oficial futura, sem fatura ou PIX inventado |
| quando instalar / "quando vão instalar minha internet?" | Instalação | equipe confirma; calendário OFF, sem agendamento fictício |

Defina os responsáveis humanos de cada destino. Se separar agentes de IA, configure intenções
no roteador pela tela; um destino humano é passagem/caso, não um agente artificial para simular
uma integração. Na dúvida, atendimento humano. Não tente configurar `ai_routers` com as tools de
routing de atendentes. Valide o roteamento real no Inbox além do Testar da versão.

**Sem cobertura:** classifique com `sem-cobertura`, mantenha contato, contexto e motivo de perda,
sem excluir/anonimizar como rotina de fechamento. Permanece recuperável para expansão futura.
Combine uma revisão pela equipe; não prometa notificação automática por cobertura que não existe.
**Desistiu/Sem retorno:** registre o motivo e encerre a régua combinada; silêncio não autoriza
excluir histórico ou enviar indefinidamente. Respeite consentimento e pedido para parar.

**Follow-ups planejados:** acompanhamento comercial, documentos pendentes e confirmação manual
da instalação, com prazo/texto definidos pela empresa. Pausar/cancelar ao assumir humano ou
responder, conforme a política combinada. Não criar cobrança, PIX fixo ou aviso automático de
expansão/reparo sem evento e fonte oficiais. Sem cobertura não entra em perseguição comercial.

**FAQ para pedir:** planos/preços aprovados, regiões e processo de verificação de cobertura,
dados/documentos e canal seguro para contratar, procedimento de instalação, orientações básicas
aprovadas pelo suporte, horário e contatos oficiais, canal para segunda via e cancelamento.
**Memória:** regras aprovadas de triagem, limites das ofertas, destinos/responsáveis humanos,
tratamento de sem cobertura e processo de revisão para expansão. **Produtos:** catálogo simples
para descrever ofertas; não modela assinatura, periodicidade, cobertura ou billing recorrente.

**Calendário e financeiro:** agenda/calendário OFF inicialmente em `managed/internet-provider`,
inclusive para o gestor. Instalação/visita pode ganhar agenda depois, com revisão da policy e
capacidades; não é configurável por override de onboarding hoje. Financeiro genérico do CRM não
é fonte oficial de fatura do assinante. Fatura, boleto, PIX, pagamento e desbloqueio dependem de
integração real futura; **PIX nunca estático ou inventado**. Assinatura da plataforma não é
cobrança do assinante.

**Roteiro de teste (somente exemplos fictícios):**

| Mensagem/cenário | Resultado esperado |
|---|---|
| "Quero contratar internet para o meu bairro" | Comercial; pergunta local/plano conforme o que falta; não confirma cobertura automaticamente |
| "A equipe verificou que não tem cobertura aqui" | registra sem cobertura, preserva contato e interesse para expansão, sem prometer consulta/retorno automático |
| "Minha internet caiu e já tentei a orientação básica" | triagem conservadora e passagem ao suporte humano; humano consegue assumir no Inbox |
| "Preciso da segunda via e do PIX" | Financeiro; informa encaminhamento, não emite fatura, chave PIX ou confirmação de pagamento |
| "Paguei, pode desbloquear?" | pede conferência pela equipe oficial; não confirma baixa ou desbloqueia |
| "Quando vão instalar? Tem horário amanhã?" | Instalação; equipe confirma, sem calendário ativo ou promessa de data |
| "Quero cancelar e falar com uma pessoa" | registra demanda, classifica cancelamento e passa para humano |

No Testar, confira texto e propostas de ação; depois valide roteamento, caso/passagem e tomada
humana pela tela. Para managed, confira o seletor de organização, áreas do cliente e recusas de
configuração técnica/calendário. Não declare integração de cobertura/billing provada pela prévia.
## Escritório de advocacia

**Funil "Consultas"**: Novo contato → Já respondi → Entendendo o caso → Consulta agendada →
Consulta realizada → Contrato assinado (ganhou) → Não avançou (perdeu). **Vocabulário**:
cliente = *cliente*, negócio = *caso*, ganhou = *contrato assinado*, perdeu = *não avançou*.

**Prompt (preencha):**

```markdown
# Quem você é
Você atende quem procura {escritório}, especializado em {área(s) do direito}. Seu nome é
{nome}. Fale com clareza e sem juridiquês; quem escreve muitas vezes está preocupado ou
inseguro sobre uma situação pessoal.

# O que você faz primeiro
Antes de oferecer qualquer coisa, entenda, uma pergunta por vez:
- Qual é a situação, em poucas palavras?
- Quando aconteceu (ou quando terminou, se for vínculo empregatício)?
- Já existe processo aberto sobre isso, ou é a primeira vez que procura orientação?
- Tem documentos à mão que ajudem a entender o caso?

# Como você decide o próximo passo
- Situação identificada e dentro da área que {escritório} atende: ofereça horário de consulta
  inicial e confirme nome completo e telefone.
- Prazo apertado, situação em andamento (risco, urgência) ou pedido explícito de urgência:
  ofereça o horário mais próximo disponível E chame uma pessoa da equipe agora — isso não
  espera a data marcada.
- Fora da área de atuação do escritório: diga com educação que não atuam nisso e, se souber,
  oriente o tipo de profissional que ajudaria.

# Situações
- "Quanto eu tenho direito a receber?" / "vou ganhar a causa?": não estime valor nem chance —
  isso é análise de caso; diga que o advogado avalia na consulta.
- "Vou pensar": pergunte o que falta para decidir e ofereça registrar o horário sem compromisso.
- Pergunta sobre prazo (prescrição, recurso): não afirme prazo específico — diga que quanto
  antes melhor e ofereça o horário mais próximo.

# Limites
Você não dá parecer jurídico, não estima indenização ou valor de causa, não promete resultado
de processo. Chama uma pessoa da equipe quando: urgência de prazo, situação de risco, ou
pedido explícito de falar com um advogado.

# Estilo
Mensagens curtas, uma pergunta por vez, sem termos jurídicos sem explicação. Emoji: não.
```

**Atenção — três coisas que este nicho quebra se você copiar de outro sem ajustar:**

1. **Mencionar "advogado" ou termos jurídicos passa por cima do agente — sempre, sem exceção, e
   isso NÃO é configurável por agente.** Antes de qualquer LLM rodar, o worker aplica um gate fixo
   da plataforma (`checkG4Legal`, `lib/ai/handoff/regex.ts`, gatilho G4): se a mensagem do lead
   casar com `advogad\w*`, `processo judicial`, `justiça`, `juiz\w*`, `reclame aqui`,
   `denúncia`/`denuncia`, `acionar a justiça`, `órgão regulador`, `defensoria`, `ministério
   público` ou `procon`, a conversa vai direto para handoff humano — não é um item de
   `ai_agents.guardrails` (esse jsonb é outra coisa: guardrails *por agente*, 5 tipos, nenhum
   deles é este). Para a maioria dos nichos isso é sinal raro de reclamação grave contra a própria
   empresa; **para um escritório de advocacia é o vocabulário normal do dia a dia do cliente** —
   "quero falar com o advogado", "já entrei com processo", "isso vai parar na justiça" são frases
   comuns de quem já procura o escritório, não ameaça. Não tem como desligar isso hoje (é gate de
   plataforma, não de tenant): avise o escritório que boa parte das conversas vai escalar para
   humano rápido, e desenhe o prompt para o cenário em que a IA faz só a primeira pergunta antes de
   passar — não uma triagem longa. Se isso incomodar de verdade, é questão de produto a levar ao
   dono (issue), não algo para contornar no prompt.
2. **"Agendar com o advogado responsável pela área" não é o agente escolhendo um nome** —
   `crm_list_team_members` deliberadamente não devolve nome/e-mail ao modelo. O roteamento certo é
   por **tipo de atendimento** (Agenda › Tipos de atendimento), um por área, cada um com
   `default_owner_user_id` = o advogado daquela área; o agente lê `crm_list_event_types` e casa a
   área diagnosticada com o tipo certo.
3. **Sigilo profissional entre áreas não é resolvido pelo produto hoje.** `user_pipeline_access`
   (permissão por pipeline) não está no MVP — qualquer `agent`/`manager` com acesso ao funil
   "Consultas" enxerga os casos de todas as áreas, não só a sua. Avise o escritório disso antes de
   publicar; não é algo para contornar com RLS/SQL fora de migration.

**Campos do funil** (`Configurações › Funis` → campos personalizados, não pede migration):
`area_direito` (select, com as áreas que o escritório atende), `urgencia` (select: Alta/Média/
Baixa), `numero_processo` (text, se já houver processo aberto). `type: date` (ex. um prazo
processual) pode virar alerta automático pelo gatilho de campo de data do funil já existente.

**Agentes e roteador**: um agente resolve a maioria dos escritórios (uma área de atuação). Com
mais de uma área (ex. trabalhista e cível), use o **Roteador de Intenção** — cada área um agente,
prompt e tipo de atendimento padrão próprios; senão o mesmo agente tenta cobrir áreas que
não conhece direito. **Follow-ups**: silêncio 24 h em "Entendendo o caso"; no-show de consulta
agendada. **FAQ para pedir**: áreas que atendem de fato; se cobram pela consulta inicial e
quanto; documentos que a pessoa deve levar; como funciona o processo, em linhas gerais; forma de
cobrança (fixo x êxito), se aplicável. **Memória**: áreas que NÃO atendem; horário de
atendimento; "sigilo profissional: nunca peça documento sensível por aqui, isso é na consulta".
**Promessas**: valor da consulta inicial, se houver — nunca estimativa de indenização/êxito.
**Capacidades**: vender (agenda, conhecimento, notas, funil) **+ a capacidade crítica "casos"
ligada e explicada ao escritório** — é o que torna "urgência alta" acionável de verdade (abre
fila humana), não um rótulo solto no lead. **Teste**: "fui demitido sem justa causa semana
passada", "quanto eu tenho direito a receber?", "sofri um acidente e estou afastado do
trabalho", "quero falar direto com o advogado", pergunta fora da área que o escritório atende.

*Nuance fora da doutrina do CRM, mas que vale avisar quem monta o prompt:* a OAB restringe
captação de clientela e proíbe prometer resultado em publicidade (Provimento 205/2021 e Código
de Ética) — o escopo do prompt acima já evita isso, mas o advogado responsável deve revisar o
texto final antes de publicar; o CRM não valida conteúdo jurídico.

---

## Outro tipo de negócio (genérico)

**Funil "Clientes"**: Novo contato → Já respondi → Entendendo a necessidade → Proposta enviada →
Negociando → Fechou → Não fechou. Use o esqueleto de `prompt-do-agente.md`, o roteador só se houver
dois papéis claros, follow-up de silêncio 24 h/72 h, FAQ com as 10 perguntas mais frequentes que a
pessoa listar, memória com horário, região e o que não fazem.

---

## Roteiro de teste — como ler o resultado do botão Testar

Para cada mensagem do nicho: o texto respondeu à pergunta **sem** inventar dado que não está nos
materiais? Fez **uma** pergunta por vez? Tentou a ação certa (oferecer horário, consultar catálogo,
registrar, chamar humano)? Algum portão vetou — e o veto veio do prompt (jargão, promessa)? Anote
o que ajustar no `pacote-<cliente>.md` antes de publicar. A prévia não prova roteador, envio ou
handoff real: valide a passagem, a tomada humana e a retomada pela tela em ambiente de teste.
Use apenas mensagens/dados fictícios nos roteiros e na evidência.
