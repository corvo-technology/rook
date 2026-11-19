---
title: "Modo de teste"
description: "Construa e teste a integração de ponta a ponta sem gastar crédito e sem assinatura: chave de teste, limites e como passar para produção."
sidebar:
  order: 10
---

O modo de teste deixa você construir e validar a integração inteira antes de vender. Nada feito com a chave de teste é cobrado, entra na receita ou consome o crédito do seu fundo.

## A chave de teste

Em **Configurações > Parceria > Integração**, na seção **Teste**, use **Criar chave de teste**. A chave começa com `cpk_test_` e aparece uma só vez; guarde-a no backend, como a chave de produção. **Nova chave** troca a de teste sem mexer na de produção: a antiga para de funcionar na hora.

Use a chave de teste no mesmo cabeçalho de sempre e nos mesmos endereços:

```bash
curl -X PUT https://SEU-ROOK/api/partner/v1/tenants/loja-teste-1 \
  -H "Authorization: Bearer cpk_test_..." \
  -H "Content-Type: application/json" \
  -d '{ "name": "Loja de teste" }'
```

A resposta traz `"test": true`.

## O que muda no teste

- **Dados separados.** Com a chave de teste você só enxerga e só altera clientes de teste; com a de produção, só os de produção. Usar o `id` de um cliente do outro modo devolve `404`, e criar um cliente com um `id` que já existe no outro modo devolve `409` com `{ "error": "tenant_mode" }`. Use ids próprios para os testes.
- **Sem cobrança.** Clientes de teste não consomem crédito, não pedem assinatura e não entram em receita, uso, limites, faturas nem na contagem de clientes. `allowanceCents` é ignorado.
- **Modelo barato e limite diário.** Os agentes de teste sempre rodam no modelo rápido da plataforma. Cada parceiro tem um limite diário de chamadas ao modelo, somando todos os clientes de teste (por padrão, 300 por dia UTC). Ao acabar, a execução para com um aviso e volta no dia seguinte. A equipe do Rook pode ajustar o limite.
- **Marca visível.** O assistente embutido mostra uma etiqueta **Teste** na barra, e a Central lista os clientes de teste à parte (botão **Teste** em **Clientes**).

## Comércio no teste

Para parceiros com cobrança pelo Rook (`billingModel: commerce`), as chamadas de comércio com a chave de teste são **simuladas**: `PUT /subscription`, `POST /topups`, `POST /refunds`, `GET /balance` e `GET /usage` validam o pedido (plano e pacote precisam existir no catálogo; o período precisa ser válido) e respondem com o mesmo formato de produção, com `"test": true`. Nenhuma fatura, pagamento ou crédito real é criado. Um cliente de teste usa o assistente sem plano.

Uma assinatura de teste com `past_due` ou `canceled` envia `subscription.lapsed` ao webhook de teste, para você ver como o seu sistema reage.

## Webhooks de teste

Em **Integração > Teste** você define uma URL `https` de teste. Os avisos sobre clientes de teste vão **só** para ela, com `"test": true` no corpo e o cabeçalho `X-Rook-Test: true`, assinados como os de produção. Sem URL de teste, nada é enviado, e eles nunca chegam ao webhook de produção nem aos avisos por e-mail.

## Limpar dados de teste

**Limpar dados de teste** apaga todos os clientes de teste do parceiro, com agentes, arquivos e conversas. Clientes de produção nunca são tocados. Pede confirmação e fica registrado.

## Passar para produção

1. Troque a chave de teste pela de produção no backend (o resto é igual: mesmos endereços, mesmo formato).
2. Use ids de clientes de verdade; os de teste ficam separados e podem ser apagados com **Limpar dados de teste**.
3. Confira o modelo de agentes, o webhook de produção e, se for o caso, o catálogo e os preços.

A equipe do Rook acompanha o uso de teste de cada parceiro e define o limite diário.
