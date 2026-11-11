import type { GuidePage } from "../types.js";

export const selfHosting: GuidePage = {
  slug: "self-hosting",
  text: {
    en: {
      title: "Self-hosting",
      summary:
        "The editions, what a server needs, and the options for computers, secrets and models.",
      body: `## Editions

- The desktop app running on this computer: runs everything itself, needs no account and no Docker, and keeps data on that computer.
- Your own server: a long-running API and worker, a database and a computer provider, with accounts stored on your server.
- Hosted: the same product run for you, with credits or your own model key.

Nothing leaves your machines unless you add a model key or a connector. No hosted vendor is required.

## What a server needs

An API, a worker, a Postgres database and a computer provider. The published images and a Compose file run them on one machine; the self-hosting guide in the repository has the steps and the full list of settings.

## Computer provider

Bots run commands and browse in a computer. A server chooses one: Docker on the same machine, a Kubernetes cluster, a remote service such as E2B, Daytona or Boat, or none, which keeps chat and connectors but no computers.

## Secrets and encryption

Content and saved credentials are encrypted with keys the operator sets. The installer fills the required secrets; keep them backed up, because encrypted data cannot be read without them.

## Models and memory

Connect your own key or a local model under **Settings** › **Models**. Memory can stay built-in or use a provider you run.

## When it goes wrong

If bots cannot run commands, check the computer provider setting first. For the exact variable names and recovery steps, point the person to the self-hosting guide in the repository rather than guessing.`,
    },
    "pt-BR": {
      title: "Hospedagem própria",
      summary:
        "As edições, o que um servidor precisa e as opções de computadores, segredos e modelos.",
      body: `## Edições

- O app desktop neste computador: roda tudo sozinho, não precisa de conta nem de Docker e mantém os dados nesse computador.
- Seu próprio servidor: uma API e um worker sempre ativos, um banco de dados e um provedor de computadores, com contas guardadas no seu servidor.
- Hospedada: o mesmo produto rodando para você, com créditos ou sua própria chave de modelo.

Nada sai das suas máquinas, a menos que você adicione uma chave de modelo ou um conector. Nenhum fornecedor hospedado é obrigatório.

## O que um servidor precisa

Uma API, um worker, um banco Postgres e um provedor de computadores. As imagens publicadas e um arquivo Compose rodam tudo em uma máquina; o guia de hospedagem própria no repositório tem os passos e a lista completa de configurações.

## Provedor de computadores

Os bots executam comandos e navegam em um computador. Um servidor escolhe um: Docker na mesma máquina, um cluster Kubernetes, um serviço remoto como E2B, Daytona ou Boat, ou nenhum, que mantém chat e conectores mas sem computadores.

## Segredos e criptografia

O conteúdo e as credenciais salvas são criptografados com chaves definidas pelo operador. O instalador preenche os segredos obrigatórios; guarde-os com backup, porque os dados criptografados não podem ser lidos sem eles.

## Modelos e memória

Conecte sua chave ou um modelo local em **Configurações** › **Modelos**. A memória pode continuar integrada ou usar um provedor que você mantém.

## Quando algo dá errado

Se os bots não executam comandos, confira primeiro a configuração do provedor de computadores. Para os nomes exatos das variáveis e os passos de recuperação, indique à pessoa o guia de hospedagem própria no repositório em vez de adivinhar.`,
    },
  },
};
