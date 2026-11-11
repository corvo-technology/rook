import type { GuidePage } from "../types.js";

export const routines: GuidePage = {
  slug: "routines",
  text: {
    en: {
      title: "Routines",
      summary:
        "Work that runs by itself on a schedule or when something happens, with steps and a run history.",
      body: `## What a routine is

A routine gives an agent an instruction to carry out by itself. Open **Routines** and use **New routine**: pick the **Agent**, write what it should do each time, and choose when it runs, then **Create routine**.

## Triggers

- **On a schedule**: every hour, day, week or month, at a time you choose, or with a cron expression under **Advanced**.
- **When something changes**: watches a file, a command's output or an app, and runs when it changes.
- **When a webhook fires**: runs when something posts to the routine's address.

A routine can have a different **Model** from its agent's.

## Steps

**Add step** makes another agent act after the last one finishes, receiving its answer. Use it for work that passes between agents instead of creating a second routine.

## Running and history

**Run now** runs it immediately. **Test run** tries it without waiting for the trigger. **Run history** lists each run with its result and the runs that **Failed**. A routine can be turned off without deleting it.

## Through the Chief

Ask the Chief to schedule something. It first checks the existing routines, adds a step to a matching one, or creates a new one; you approve a card before it is saved.

## When it goes wrong

Open **Run history** to read the error of a failed run. A routine runs on its own, so it cannot ask you for approval: an action that needs approval stops the run.`,
    },
    "pt-BR": {
      title: "Rotinas",
      summary:
        "Trabalho que roda sozinho em um horário ou quando algo acontece, com etapas e histórico de execuções.",
      body: `## O que é uma rotina

Uma rotina dá a um agente uma instrução para executar sozinho. Abra **Rotinas** e use **Nova rotina**: escolha o **Agente**, escreva o que ele deve fazer a cada vez e escolha quando roda, depois **Criar rotina**.

## Gatilhos

- **Em um horário**: a cada hora, dia, semana ou mês, no horário que você escolher, ou com uma expressão cron em **Avançado**.
- **Quando algo mudar**: observa um arquivo, a saída de um comando ou um app e roda quando muda.
- **Quando um webhook disparar**: roda quando algo envia para o endereço da rotina.

Uma rotina pode ter um **Modelo** diferente do modelo do agente.

## Etapas

**Adicionar etapa** faz outro agente agir depois que o último terminar, recebendo a resposta dele. Use para trabalho que passa entre agentes, em vez de criar uma segunda rotina.

## Executar e histórico

**Executar agora** roda na hora. **Execução de teste** tenta sem esperar o gatilho. **Histórico de execuções** lista cada execução com o resultado e as que deram **Falha**. Uma rotina pode ser desligada sem ser excluída.

## Pelo Chefe

Peça ao Chefe para agendar algo. Ele primeiro confere as rotinas existentes, adiciona uma etapa a uma que combine ou cria uma nova; você aprova um cartão antes de salvar.

## Quando algo dá errado

Abra **Histórico de execuções** para ler o erro de uma execução com falha. Uma rotina roda sozinha, então não consegue pedir aprovação: uma ação que precisa de aprovação para a execução.`,
    },
  },
};
