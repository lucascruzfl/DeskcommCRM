# FICTÍCIO — APENAS TESTE — NÃO USAR COMO DEFAULT DE PRODUÇÃO

Cliente sintético: **Fibra Horizonte Demo**. Nenhuma pessoa, empresa, conta, número, credencial ou canal real faz parte deste piloto. Esta transcrição representa a reunião que um operador entregaria ao Codex/Claude Code antes de configurar um cliente.

## FACTS — fatos confirmados pelo cliente fictício

- O provedor regional informou possuir rede em Centro, Planalto, São José e Lagoa Nova. Isso não confirma disponibilidade em nenhum endereço específico.
- Planos residenciais informados, exclusivos deste tenant de teste: 300 Mbps por R$ 79,90; 500 Mbps por R$ 99,90; 700 Mbps por R$ 119,90.
- Atendimento humano: segunda a sexta, 8h às 18h, e sábado, 8h às 12h. Mensagens podem chegar fora desse horário.
- Referência operacional: instalação normalmente em até três dias úteis depois de cobertura e documentos confirmados, sujeita à agenda da equipe.
- O CRM não possui integração com ERP de cobrança, OLT, ONU, RADIUS ou rede do provedor.

## POLICIES — regras operacionais declaradas

- Bairro e CEP isolados nunca autorizam afirmar cobertura exata. Coletar CEP, rua, número, complemento quando houver, bairro e cidade; a equipe confirma cobertura e disponibilidade de porta.
- Preços podem ser apresentados se estiverem atualizados no acervo do tenant. A mudança de preço é configuração, não mudança de código.
- Não prometer taxa de instalação zero; se o dado atual faltar, encaminhar para verificação.
- Prazo de três dias úteis é previsão, nunca data ou compromisso. Data exata depende da equipe.
- Suporte básico: conferir se ONU e roteador estão ligados, observar as luzes, desligar somente o roteador da tomada, esperar cerca de 30 segundos e religar uma vez. Se persistir, passar ao suporte humano.
- Não pedir nem armazenar senha Wi-Fi. Não afirmar diagnóstico ou operação remota de rede.
- Segunda via e pagamento declarado dependem do financeiro humano. Não gerar boleto/PIX, confirmar pagamento ou desbloquear conexão.
- Verificações de retaguarda podem virar caso humano com conversa ainda em andamento. Pedido de pessoa, irritação ou necessidade de conversa humana exige handoff; a IA silencia até devolução humana.
- Fora do horário humano, receber mensagem sem prometer resposta humana imediata.

## FOLLOWUP_TIMINGS — somente para este piloto

| Situação | wait_minutes | task_due_days | Gatilho |
| --- | ---: | ---: | --- |
| Plano apresentado sem resposta | 1440 | 0 | etapa; cancela com resposta |
| Aguardando documentos | 2880 | 0 | etapa |
| Instalação parada | 1440 | 0 | etapa |
| Sem cobertura | 43200 | 0 | manual, após classificação humana |

`task_due_days=0` significa que a tarefa interna vence no dia em que o fluxo a cria, **depois da espera**. A reunião só fixou o tempo até criar a tarefa, não um prazo adicional para concluí-la. Os quatro flows ficam em draft, inativos e sem envio externo. “Sem cobertura” continua manual porque o evento da etapa perdida não distingue o motivo.

## KNOWLEDGE — acervo consultável do tenant sintético

- Lista de bairros com rede informada, junto com a ressalva de cobertura por endereço.
- Os três planos e preços acima, com indicação de atualização pelo operador.
- Horário humano e recebimento de mensagens fora dele.
- Procedimento básico de suporte e limite de uma tentativa de reinício do roteador.
- Referência de instalação após pré-requisitos, sem data exata.

## MEMORY_RULES — comportamento durável da organização

- Nunca inferir cobertura por bairro ou CEP; abrir caso para conferência humana do endereço completo.
- Nunca inventar PIX, boleto, confirmação de pagamento ou desbloqueio.
- Não solicitar ou registrar senha Wi-Fi.
- Não prometer data de instalação sem confirmação da equipe.
- Caso humano para verificações de cobertura, segunda via, pagamento e status de instalação; handoff quando uma pessoa for solicitada ou precisar assumir.
- Após handoff, a IA silencia; só uma pessoa devolve o atendimento à IA com continuidade.

## HUMAN_DEPENDENCIES — verificações que exigem pessoa

- Cobertura por endereço completo e porta disponível; taxa especial de instalação; agenda/data de instalação; segunda via; pagamento; desbloqueio; problema persistente após suporte básico; casos irritados ou com pedido explícito de pessoa.

## UNRESOLVED — perguntas antes de um cliente real entrar no ar

- Qual é o endereço operacional e a cidade exata da empresa? Qual fuso deve ser configurado?
- Quem receberá cada fila/caso e qual SLA humano? Qual número real ficará WORKING?
- Quais são o provider, modelo e credencial válidos da instalação? Quem aprova publicação e ativação?
- Existe tabela vigente de taxas de instalação e alterações recentes de planos? Quem mantém esses dados?
- Quais documentos são necessários para contratar? Como a equipe confirma a cobertura e informa o resultado ao cliente?
- Qual é a política para domingos/feriados e a data de vigência dos preços/horários?

## IDEAS — recomendações da IA, sem autoridade de fato

- Criar uma rotina de revisão periódica de planos e preços.
- Criar uma fila e SLA por área após o cliente designar responsáveis.
- Estudar futura integração com cobertura, ERP e agenda técnica, com contrato e autorização próprios.
- Registrar feedback de classificações erradas para revisar exemplos do router e acervo.

**Nenhuma IDEIA entra na configuração automaticamente.** O piloto usa apenas as decisões operacionais explícitas da transcrição e os campos que o schema exige.
