---
impacto: nada_mudou
secao: corrigido
titulo: Quem escolheu outra IA na instalação deixa de pedir a ela um modelo da Anthropic
---

Ao escolher na instalação uma IA diferente da Anthropic (a OpenAI, por exemplo), o
sistema trocava o provedor da empresa mas deixava gravado o modelo padrão da Anthropic.
O que usa o modelo padrão da empresa — a medição do clima da conversa, entre outros —
pedia à OpenAI um modelo que ela não tem, e falhava.

Agora a instalação grava o provedor junto com um modelo dele. Nas instalações que já
estão com a combinação errada, a medição do clima passa a usar um modelo do provedor
escolhido (o marcado como padrão, quando há), sem que você precise mexer em nada. Se você
já escolheu o modelo padrão em IA › Provedores, a sua escolha continua valendo.
