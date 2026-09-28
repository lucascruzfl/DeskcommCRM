# A triagem — o que perguntar, em que ordem, e por que o sistema precisa disso

Uma pergunta por vez. Cada bloco existe porque uma tela ou uma regra do produto exige a resposta;
o "por quê" está ao lado para explicar quando a pessoa hesitar. Registre decisões e pendências
em `pacote-<cliente>.md`, sem segredos ou dados pessoais. Credenciais entram somente na superfície
oficial; não peça a chave na conversa nem a copie para documentação.

## 0. Organização e modelo de gestão

| pergunta | por quê |
|---|---|
| É o próprio negócio ou cliente da agência? A organização já existe? | decide entre configurar o tenant atual e o onboarding de cliente gerenciado |
| Qual nicho: clínica, imobiliária, serviços, curso, loja ou provedor de internet (ISP)? | escolhe o pacote; ISP tem limites de cobertura, calendário e billing próprios |
| Se vai criar managed: o operador é platform_admin ativo scope full? | admin comum, manager e agent não criam; `cliente-gerenciado.md` explica o preflight e os gates |
| Quem será o gestor e quem receberá o convite oficial? | gestor ganha membership admin; cliente é convidado agent e acessa pelo organization switcher |

Em managed, consulte `managed/aesthetic-clinic` ou `managed/internet-provider` e as áreas
client/agency/shared/not_applicable. Não proponha criar outro tenant se o cliente já tem um.

## 1. O negócio

| pergunta | por quê |
|---|---|
| Como o negócio se chama e o que ele faz, em uma frase? | vira a primeira linha do prompt ("Você atende os clientes de X, que é: …") e escolhe o pacote do nicho |
| Razão social e cidade/fuso horário | a razão social nomeia o controlador nos documentos de LGPD; o fuso decide "que horas são" para o agente e a janela de envio |
| Quem é o cliente típico e o que ele costuma pedir primeiro? | é o diagnóstico que o agente faz antes de oferecer |

## 2. O canal

| pergunta | por quê |
|---|---|
| Qual número de WhatsApp vai atender (já conectado?) | o agente exige um número com status WORKING para publicar |
| Horário em que o agente responde (dias, início, fim) | fora da janela o turno é **adiado**, não perdido — mas a pessoa precisa saber que o cliente das 23h só recebe resposta de manhã |
| Quantas mensagens por dia esse número aguenta? (número novo = aquecimento) | limite diário e aquecimento evitam bloqueio do WhatsApp |

## 3. A IA

| pergunta | por quê |
|---|---|
| Qual provedor (OpenRouter, Anthropic, OpenAI, Google) e se a credencial já foi cadastrada | credencial precisa ser **validada** para publicar; Google só funciona como credencial da organização |
| Tem chave da OpenAI para áudio e base de conhecimento? | sem chave resolvida na organização ou instalação, transcrição/indexação ficam indisponíveis; confira o estado e a pendência |
| Teto de gasto mensal com IA | o produto pausa o agente ao estourar; sem teto, não pausa |

## 4. O funil

| pergunta | por quê |
|---|---|
| As etapas do pacote do nicho servem? Quer renomear alguma? | revise os limites da tela/schema atual; uma etapa de ganho e uma de perda, com motivos distintos para os fechamentos ISP |
| Como vocês chamam o cliente, o negócio, o "ganhou" e o "perdeu"? (paciente/consulta marcada; interessado/fechou) | é o vocabulário que aparece na tela e que o agente usa para não falar "lead" com paciente |
| Motivos de perda que valem registrar | vão para a lista de motivos e para a análise depois |

## 5. Os agentes

| pergunta | por quê |
|---|---|
| Um agente só, ou papéis separados (recepção/vendas/suporte/pós-venda)? | mais de um agente no mesmo número exige roteador |
| Como o agente se chama e em que tom fala (caloroso, objetivo, formal)? | tom é texto no prompt — não há botão |
| O que ele **pode** fazer sozinho: agendar, mover no funil, mandar proposta, dar desconto até X? | capacidades e tabela de promessas |
| O que ele **nunca** faz e quando chama uma pessoa (palavras-gatilho, situações) | palavras de passagem para humano + casos |
| O que a pessoa do time precisa receber quando assume (resumo, o que já foi prometido) | o handoff entrega isso; o prompt pode pedir o que registrar |

## 6. O roteador (só com 2+ agentes no mesmo número)

| pergunta | por quê |
|---|---|
| Que assuntos vão para cada agente? Três exemplos de frase de cliente por assunto | intenção = nome + descrição + exemplos; o classificador decide por eles |
| Quem atende quando não dá para saber? | agente de fallback |
| O cliente fica com o mesmo agente na conversa? | modo "grudado" (sticky) |

## 7. Os follow-ups

| pergunta | por quê |
|---|---|
| O que fazer quando o cliente some no meio (após quanto tempo, quantas vezes, com que mensagem)? | gatilho por silêncio + esperas + mensagens; no máximo o que o número aguenta |
| Situações próprias do nicho: faltou à consulta, abandonou o pagamento, não respondeu o orçamento | gatilhos de no-show, mudança de etapa, caso aberto |
| O que **para** o follow-up (respondeu, pediu humano, pediu para parar) | política de handoff e cancelamento por resposta |

## 8. Conhecimento

| pergunta | por quê |
|---|---|
| Perguntas que os clientes mais fazem e as respostas oficiais (10 a 30) | FAQ — a fonte mais barata e mais usada |
| Documentos (PDF/MD/TXT até 20 MB cada): tabela de preços, políticas, catálogo, manual | fontes por documento; catálogo de loja vem da integração |
| O que o agente **não** deve responder mesmo sabendo | limites no prompt + passagem para humano |

## 9. Memória da organização (regras da casa)

Fatos que valem para **todos** os agentes: "não abrimos domingo", "só atendemos maiores de 18",
"parcelamos em até 6x sem juros", "o endereço é…". Curtos, um por linha.

## 10. Promessas e limites comerciais

Piso de preço, desconto máximo, parcelas máximas. O produto veta promessa fora da tabela — mas
só se a tabela existir.

## 11. Automações e integrações

Formulário do site, anúncios (Meta), loja (Nuvemshop), agenda (Google): o que entra no funil e o que
o agente faz quando entra. Para ISP, calendário OFF inicialmente; cobertura e billing precisam de
fonte real. Financeiro do CRM não substitui a fatura de assinante.

## 12. O time

Quem atende quando a IA passa, com que e-mail e papel (atendente, gerente, admin); como as
conversas se distribuem (manual ou rodízio). A IA atende normalmente; quando precisa de pessoa,
abre caso/passagem, e o humano assume no Inbox. Combine retorno à IA depois da resolução.

## 13. Provedor de internet — dados e limites antes da oferta

| pergunta | por quê |
|---|---|
| Quais regiões atendem e quem confirma cobertura? Existe integração funcionando ou verificação manual? | não há consulta ISP de cobertura no preset; endereço/CEP/bairro são dados para qualificar, não prova de cobertura |
| Quais planos, preços e condições oficiais podem ser apresentados? | Produtos é catálogo comercial simples; não modela assinatura, periodicidade ou contrato |
| Quais dados são necessários para qualificar e depois contratar? | coletar endereço/CEP/bairro, telefone e plano de interesse quando aplicável, sem pedir documentos sensíveis no chat |
| Quem recebe Comercial, Suporte, Financeiro e Instalação, e em qual horário? | os assuntos têm destinos distintos; queda de internet requer triagem conservadora e humano quando necessário |
| Como preservar quem está sem cobertura e rever na expansão? | classificar sem apagar, com tag/motivo e próximo passo; o retorno depende de revisão real da equipe |
| Como a equipe confirma instalação e informa fatura hoje? | agenda OFF; instalação/visita pode ter agenda futura, fatura/PIX/pagamento/desbloqueio dependem de integração real futura |

Não pergunte chave PIX para colocá-la como texto fixo. Não prometa segunda via, baixa de pagamento,
desbloqueio ou visita agendada automaticamente sem ferramenta e fonte reais.

## O que você não pergunta

Nada técnico (modelo exato, temperatura, tokens): você escolhe pelo pacote e explica em uma
frase. Nada que esteja nos documentos que a pessoa entregou — leia antes de perguntar.
