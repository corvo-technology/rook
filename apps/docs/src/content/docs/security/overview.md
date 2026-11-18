---
title: "Segurança e privacidade"
description: "Isolamento de dados, cifra, auditoria e notas de LGPD."
sidebar:
  order: 1
---

## Isolamento de dados

- **Por espaço.** Cada espaço (e, para parceiros, cada cliente) é uma organização separada. Pessoas, agentes, conversas, memória e conexões de um nunca aparecem em outro, e o isolamento é aplicado no servidor e no banco de dados, não na interface.
- **Entre parceiros.** Um parceiro só alcança os próprios clientes: a chave de um parceiro nunca vê, nem confirma a existência dos clientes de outro (as duas situações respondem `404`).
- **Entre agentes.** As conversas privadas de uma pessoa com um agente continuam dela. A memória de uma pessoa é dela, em cada espaço.
- **Computadores.** Cada espaço tem o seu computador; agentes que precisam de isolamento próprio podem usar um computador privado, e o navegador de cada agente tem perfil separado.
- **Conexões.** Cada agente só alcança o que você liberou, no nível que você definiu (Sem acesso, Leitura, Leitura e escrita). Um banco conectado é somente leitura e só aceita uma consulta por vez.

## Cifra

O conteúdo do usuário é cifrado antes de chegar ao banco de dados ou ao armazenamento de arquivos: mensagens, eventos de conversa, memória, páginas da wiki, arquivos enviados e gerados, e credenciais. Um backup ou disco copiado não revela esse conteúdo. A conexão com o Rook usa TLS.

## Ações reais exigem aprovação

Por padrão, qualquer ação que muda algo espera o aval de uma pessoa. Os [modos de aprovação](/start/approvals/) e os limites de [orçamento](/agents/models/#orçamentos) são aplicados pelo servidor; nenhum agente consegue alterá-los.

## Auditoria

O Rook registra eventos de segurança, sem conteúdo de mensagens, segredos ou tokens:

- entradas, saídas e tentativas falhas de acesso;
- revogação de sessões e mudança de credenciais;
- criação, alteração e remoção de credenciais de modelos, conectores e segredos;
- decisões de aprovação e mudanças de política;
- destinos internos ou privados recusados;
- cada consulta que um agente faz a um banco conectado (conexão, agente, duração, linhas, resultado, **nunca** o texto da consulta nem as linhas);
- para parceiros, criação, leitura e exclusão de gravações de consultas.

Os registros são imutáveis e mantidos por tempo limitado.

## Segredos

Credenciais ficam cifradas e nunca são devolvidas ao modelo. Quando um agente precisa de um segredo, ele o **solicita** a uma pessoa em vez de lê-lo de algum lugar.

## LGPD

:::note
Esta página descreve controles técnicos e não é aconselhamento jurídico. Os papéis de controlador e operador dependem do seu caso; confirme-os com o seu jurídico.
:::

- **Minimização.** O Rook envia aos provedores de modelo só o necessário para cada turno. O conteúdo não é usado para treinar modelos e não vai para logs.
- **Consentimento.** Em fluxos sensíveis, como a [gravação de consultas](/partners/consultations/), o consentimento do titular é obtido **pelo parceiro antes** e é guardado com o registro. Sem ele, nada é gravado.
- **Retenção e exclusão.** O áudio e a transcrição de uma consulta são apagados no prazo que o parceiro escolhe (1 a 365 dias) ou na hora, sob demanda. A memória e a wiki podem ser lidas, corrigidas e apagadas pelas pessoas do espaço.
- **Pausa.** Um parceiro pode pausar um cliente a qualquer momento: as execuções param e as sessões abertas são encerradas.
- **Decisões ficam com pessoas.** O que o Rook produz a partir de dados pessoais chega como rascunho; a decisão e a assinatura continuam sendo de uma pessoa.

## Reportar uma vulnerabilidade

Escreva para [security@rook.team](mailto:security@rook.team). Não abra um chamado público com detalhes da falha.
