---
impacto: capacidade_nova
secao: corrigido
titulo: O clima da conversa passa a ser medido quando a chave de IA foi cadastrada pela tela
---

O sistema lê o clima de cada mensagem do cliente e chama uma pessoa da equipe quando ele
se irrita. Esse medidor só funcionava quando a chave de IA estava no arquivo de
configuração da instalação. Se a chave foi cadastrada pela tela (IA › Credenciais), ele
não media nada, sem aviso nenhum. O `install.sh` permite pular a chave e cadastrar
depois pela tela.

Agora ele usa a chave cadastrada pela tela. Com a Anthropic ou a OpenRouter, a partir
desta versão o clima passa a ser medido, a conversa com cliente irritado passa para uma
pessoa, e cada medição aparece em IA › Execuções e entra no gasto de IA do mês.

Com a OpenAI, o Google ou a DeepSeek, sem um modelo escolhido em IA › Provedores › "Medir
o clima da conversa", o clima passa a ser medido pelo modelo padrão da empresa — o mesmo
que o painel já dizia estar valendo ali —, com a chave cadastrada pela tela ou com a do
arquivo de configuração. Esse modelo costuma ser mais caro que o de classificação; para
gastar menos, escolha um modelo menor nesse mesmo lugar.
