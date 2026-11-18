---
title: "Central do parceiro"
description: "Clientes, créditos, integração e agentes da carteira, dentro do seu Rook."
sidebar:
  order: 4
---

A **Central do parceiro** fica dentro do seu próprio Rook, em **Configurações > Parceria**, e aparece quando o Rook aprova o seu pedido. Quem a usa precisa da permissão de gerenciar o parceiro, que os donos e o papel Admin padrão têm.

## O que tem

- **Visão geral.** Clientes, uso e o que precisa de você.
- **Clientes.** Cada cliente com números e estados, nunca conversas. Você pode pausar, retomar, dar crédito e **abrir como suporte**: uma entrada de uso único, válida por um minuto e registrada.
- **Créditos e faturas** (modo embutido). O fundo, o plano de parceiro, o uso por cliente, por recurso e por modelo, recargas e faturas.
- **Preços e receita** (indicação). O seu markup por plano e a receita por mês.
- **Integração.** Prefixo da chave, URL do webhook e troca da chave (a nova é mostrada uma vez).
- **Modelo de agentes.** Os agentes iniciais que cada cliente novo recebe.

## Controles de crédito (modo embutido)

- **Limite mensal por cliente.** No limite, o cliente deixa de usar a IA fornecida pelo Rook até você aumentar ou o mês virar. Você recebe `customer.credit_limit_reached`.
- **Modelos permitidos.** Vale só para os modelos fornecidos pelo Rook; vazio permite todos. Um modelo fora da lista é recusado e some do seletor do cliente. Modelos que o cliente conectou sozinho continuam disponíveis.
- **Recarga automática.** Quando o fundo cai abaixo do valor que você define, o Rook abre uma recarga pelo checkout.
- **Avisos.** Limite de um cliente atingido, fundo baixo, recarga automática, fatura emitida, pagamento que falhou e conector fora do ar chegam por e-mail e no app. Se quiser automatizar no seu sistema, há [webhooks](/partners/webhooks/) opcionais.

Estes controles são feitos na Central; ainda não há campos na API pública de parceiros para eles.

## Agentes da carteira

Dois agentes instaláveis trabalham a sua carteira pela conexão **Parceria**:

- **Gestor da carteira.**
- **Sucesso do cliente.**

Eles leem clientes, uso, receita e faturas. Qualquer ação (dar crédito, pausar, retomar, mudar um limite) pede a **sua aprovação a cada vez**, seja qual for o modo de aprovação do agente. Os resultados são números, estados e nomes, nunca conversas.

## White label

<span class="soon">Em breve</span>. O cliente usará o produto na sua marca, no seu domínio e com os seus e-mails. Ainda não há API documentada.
