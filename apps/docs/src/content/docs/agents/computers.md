---
title: "Computadores e navegador"
description: "A máquina de cada agente: arquivos, comandos e um navegador de verdade."
sidebar:
  order: 2
---

Um agente pode usar um **computador**: uma máquina Linux com arquivos, terminal e navegador. É assim que ele edita planilhas, roda scripts e opera sites que não têm API.

- **Computador do time (padrão):** todos os agentes do espaço compartilham arquivos e ferramentas instaladas. Cada agente começa na sua pasta; o que é compartilhado fica em `shared/`. As pastas organizam o trabalho, não isolam.
- **Computador privado:** um agente tem a máquina inteira só para ele.

Os arquivos persistem entre execuções. Quando ninguém usa, o computador se desliga e preserva o espaço de trabalho.

## O navegador

Cada agente tem o seu navegador, com **perfil próprio e persistente**: logins, cookies e histórico não se misturam com os de outro agente, e o agente continua logado na próxima execução. Você pode **assistir ao vivo** e **assumir o controle** quando o agente pedir ajuda (um captcha, uma autenticação em duas etapas).

Quantos computadores, quanto armazenamento e quantas pessoas cabem no espaço depende do plano (Pessoal, Equipe ou Empresa).
