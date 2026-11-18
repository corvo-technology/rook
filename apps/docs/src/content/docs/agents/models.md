---
title: "Modelos e orçamentos"
description: "Roteamento automático, níveis de modelo e limites mensais."
sidebar:
  order: 1
---

## Modelo do agente

Cada agente usa um modelo fixo ou o **Automático**. No Automático o Rook escolhe o modelo a cada turno, começando por sinais baratos e determinísticos, e só usa um modelo mais forte onde ele compensa.

## Níveis

| Nível | Usado para |
| --- | --- |
| **Rápido** | Turnos pequenos e rotineiros: triagem, resumos, respostas curtas. |
| **Principal** | Trabalho comum e tudo que continua uma ação já aprovada. |
| **Forte** | Código, contextos grandes e o que os outros não resolveram. |

A escolha segue esta ordem: o nível em que a execução já está; código ou agente de engenharia, pesquisa ou computador (forte); conversa muito longa (forte); continuação de uma aprovação (principal, no mínimo); agente de e-mail, triagem, suporte ou resumos com pedido curto (rápido). Se ainda for ambíguo, uma chamada mínima ao modelo rápido nomeia o nível; se ela falhar, vale o principal.

Uma execução que falha num nível mais barato por loop, ferramentas falhando em repetição ou saída inutilizável sobe **uma vez** para o próximo nível. Isso aparece na página de Uso.

## Orçamentos

Um agente pode ter um **limite mensal de tokens** (mês UTC). Ao atingir o limite, novas execuções falham antes de chamar o modelo, com um aviso claro. Cada execução também tem um teto de resposta de 10% do limite mensal, para que uma única tarefa não consuma o mês. Quem pode configurar o espaço também pode **pausar todos os agentes** de uma vez.

O limite e a pausa são aplicados pelo servidor; nenhum agente consegue ler ou mudar essas configurações.
