---
title: "Visão geral"
description: "Embutido ou marca própria, e como a receita é dividida."
sidebar:
  order: 1
---

Um **parceiro** é uma empresa que leva agentes do Rook aos seus próprios clientes. O seu backend chama uma API pequena; cada cliente recebe uma organização isolada, com um dono, um conector para o seu sistema e agentes iniciais. Nenhum dado de um cliente é visível a outro.

## Dois modos

| | Embutido | Marca própria (white label) |
| --- | --- | --- |
| Onde o cliente usa o Rook | Dentro do seu produto, pelo SDK, logado com o login do seu produto | Em um app próprio, no seu domínio e com a sua marca |
| Exemplo | Um prontuário eletrônico que embute o assistente | Uma agência que vende o seu próprio sistema de agentes |
| Quem vende a assinatura | Você, no seu checkout | O Rook, em seu nome, via Stripe Connect |
| Como o Rook recebe | Fatura mensal da parte do Rook | Taxa de aplicação sobre cada cobrança |
| Disponibilidade | **Disponível** | <span class="soon">Em breve</span> |

O modo embutido funciona hoje: [comece pelo quickstart](/partners/quickstart/). A marca própria está em desenho.

## Como o dinheiro funciona

:::note[Valores são exemplos]
Preços, percentuais e limites abaixo são exemplos. Tudo é configurável por parceiro; os números reais fazem parte do seu acordo.
:::

- O Rook vende de uma **tabela de preços** (o catálogo). Cada plano inclui crédito de IA.
- Você recebe uma **comissão** (exemplo: 20%) sobre o preço de catálogo e pode somar um **markup**, que é todo seu.
- Os clientes **sempre usam a IA da plataforma**; não há chave ou assinatura de IA do cliente nos fluxos de parceiro.
- A parte do Rook não depende do que você cobrou: um desconto que você der sai do seu lado.

Exemplo: preço de catálogo 100, comissão 20%, markup 30.

| | Valor |
| --- | --- |
| O cliente paga | 130 |
| Parte do Rook (`100 × 80%`) | 80 |
| Sua comissão (`100 × 20%`) | 20 |
| Seu markup | 30 |
| **Seu total** | **50** |

No modo embutido o cliente paga 130 a você e você deve 80 ao Rook na fatura mensal. A API de catálogo, assinaturas e recargas que automatiza isso é <span class="soon">em breve</span>; veja [Comércio](/partners/commerce/).

## Hoje, no piloto

Hoje cada cliente tem uma cota mensal de crédito (`allowanceCents`) que você define a cada chamada, paga com o saldo da conta dona do parceiro. Quando a cota chega a 80% e quando acaba, o Rook avisa por [webhook](/partners/webhooks/).

## Como se tornar parceiro

Fale com a gente em [rook.team](https://rook.team). Criamos o seu parceiro, você recebe a chave (mostrada uma única vez) e acessa o console em **Configurações > Parceria**, onde importa o modelo de agentes, define limites e pausa clientes.

Uma empresa com vários produtos cria **um parceiro por produto**: cada um tem chave, modelo, nome e cor do Chief próprios, e os clientes nunca se misturam. Todos podem usar o mesmo saldo.
