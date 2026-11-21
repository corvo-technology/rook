import type { AppMapAudience, AppMapEntry, AppMapSurface, AppMapText } from "./types.js";

const ALL: readonly AppMapSurface[] = ["web", "desktop", "mobile"];
const COMPUTER: readonly AppMapSurface[] = ["web", "desktop"];

function screen(
  id: string,
  path: string,
  audience: AppMapAudience,
  surfaces: readonly AppMapSurface[],
  en: AppMapText,
  ptBR: AppMapText,
): AppMapEntry {
  return { id, path, audience, surfaces, text: { en, "pt-BR": ptBR } };
}

/**
 * Every screen and settings section the web app routes to (`App.tsx`, the Settings sections and the
 * command palette), written once. The drift test fails when a route or section is missing here,
 * and `appMap()` adds the connectable apps from the app catalog.
 */
export const APP_MAP_SCREENS: readonly AppMapEntry[] = [
  screen(
    "home",
    "/app/home",
    "member",
    ALL,
    {
      title: "Home",
      description: "Where the day starts: what needs attention and what the agents are doing.",
      keywords: ["start", "overview", "dashboard", "today"],
    },
    {
      title: "Início",
      description: "Onde o dia começa: o que pede atenção e o que os agentes estão fazendo.",
      keywords: ["começo", "visão geral", "painel", "hoje"],
    },
  ),
  screen(
    "team",
    "/app/team",
    "member",
    COMPUTER,
    {
      title: "Team",
      description: "The agents and people of the space, and how they are organized.",
      keywords: ["agents", "bots", "people", "members", "roster", "squad"],
    },
    {
      title: "Equipe",
      description: "Os agentes e as pessoas do espaço, e como se organizam.",
      keywords: ["agentes", "bots", "pessoas", "membros", "time"],
    },
  ),
  screen(
    "approvals",
    "/app/approvals",
    "member",
    ALL,
    {
      title: "Approvals",
      description: "Actions an agent asked permission for, waiting for a yes or a no.",
      keywords: ["approve", "permission", "pending", "allow", "deny", "review"],
    },
    {
      title: "Aprovações",
      description: "Ações que um agente pediu permissão para fazer, esperando um sim ou um não.",
      keywords: ["aprovar", "permissão", "pendente", "permitir", "negar", "revisar"],
    },
  ),
  screen(
    "activity",
    "/app/activity",
    "member",
    COMPUTER,
    {
      title: "Activity",
      description: "A timeline of what the agents did, with the runs and their results.",
      keywords: ["history", "log", "runs", "timeline", "what happened"],
    },
    {
      title: "Atividade",
      description: "A linha do tempo do que os agentes fizeram, com as execuções e resultados.",
      keywords: ["histórico", "registro", "execuções", "linha do tempo", "o que aconteceu"],
    },
  ),
  screen(
    "store",
    "/app/store",
    "member",
    COMPUTER,
    {
      title: "Store",
      description: "Ready-made agents, skills and apps to add in one step.",
      keywords: ["add agent", "install", "templates", "skills", "marketplace", "apps"],
    },
    {
      title: "Loja",
      description: "Agentes, habilidades e apps prontos para adicionar em um passo.",
      keywords: ["adicionar agente", "instalar", "modelos", "habilidades", "apps"],
    },
  ),
  screen(
    "board",
    "/app/board",
    "member",
    COMPUTER,
    {
      title: "Tasks",
      description: "The ticket board: work items for people and agents, by status.",
      keywords: ["tickets", "kanban", "board", "to-do", "todo", "issues", "work"],
    },
    {
      title: "Tarefas",
      description: "O quadro de tickets: itens de trabalho de pessoas e agentes, por status.",
      keywords: ["tickets", "kanban", "quadro", "afazeres", "pendências", "trabalho"],
    },
  ),
  screen(
    "routines",
    "/app/routines",
    "member",
    ALL,
    {
      title: "Routines",
      description: "Work an agent does on a schedule or when something happens.",
      keywords: ["schedule", "cron", "recurring", "automation", "every day", "trigger"],
    },
    {
      title: "Rotinas",
      description: "Trabalho que um agente faz em horários marcados ou quando algo acontece.",
      keywords: ["agenda", "agendar", "recorrente", "automação", "todo dia", "gatilho"],
    },
  ),
  screen(
    "usage",
    "/app/usage",
    "member",
    COMPUTER,
    {
      title: "Usage",
      description: "Usage across the space over time: which agents spend the most.",
      keywords: ["cost", "tokens", "spend", "credits", "consumption", "report"],
    },
    {
      title: "Uso",
      description: "O uso do espaço ao longo do tempo: quais agentes gastam mais.",
      keywords: ["custo", "tokens", "gasto", "créditos", "consumo", "relatório"],
    },
  ),
  screen(
    "workflows",
    "/app/workflows",
    "member",
    COMPUTER,
    {
      title: "Routine flows",
      description: "Multi-step flows that chain agents and tools together.",
      keywords: ["flow", "steps", "pipeline", "chain", "automation"],
    },
    {
      title: "Fluxos das rotinas",
      description: "Fluxos de vários passos que encadeiam agentes e ferramentas.",
      keywords: ["fluxo", "passos", "pipeline", "encadear", "automação"],
    },
  ),
  screen(
    "artifacts",
    "/app/artifacts",
    "member",
    ALL,
    {
      title: "Artifacts",
      description: "Files and documents the agents made, kept in one place.",
      keywords: ["files", "documents", "outputs", "downloads", "reports", "generated"],
    },
    {
      title: "Artefatos",
      description: "Arquivos e documentos que os agentes criaram, reunidos em um lugar.",
      keywords: ["arquivos", "documentos", "resultados", "downloads", "relatórios", "gerados"],
    },
  ),
  screen(
    "wiki",
    "/app/wiki",
    "member",
    ALL,
    {
      title: "Wiki",
      description: "The space's shared knowledge pages that agents read and keep up to date.",
      keywords: ["knowledge", "docs", "notes", "memory", "pages", "shared"],
    },
    {
      title: "Wiki",
      description: "As páginas de conhecimento do espaço que os agentes leem e mantêm.",
      keywords: ["conhecimento", "documentação", "notas", "memória", "páginas", "compartilhado"],
    },
  ),
  screen(
    "partner",
    "/app/partner",
    "partner",
    COMPUTER,
    {
      title: "Partner",
      description: "The partner console: customers, pricing, credits, invoices, brand and domain.",
      keywords: ["partner", "reseller", "white label", "customers", "revenue", "domain", "brand"],
    },
    {
      title: "Parceiro",
      description: "O console do parceiro: clientes, preços, créditos, faturas, marca e domínio.",
      keywords: ["parceiro", "revenda", "marca própria", "clientes", "receita", "domínio"],
    },
  ),
  screen(
    "plans",
    "/app/plans",
    "owner",
    COMPUTER,
    {
      title: "Plans",
      description: "Plans and prices on a partner's domain: pick, change or pay for a plan.",
      keywords: ["partner plans", "white label", "checkout"],
    },
    {
      title: "Planos",
      description: "Planos e preços no domínio de um parceiro: escolher, trocar ou pagar um plano.",
      keywords: ["planos do parceiro", "marca própria", "checkout"],
    },
  ),
  screen(
    "settings-general",
    "/settings/general",
    "member",
    ALL,
    {
      title: "General",
      description: "Your name, email, time zone and the spaces you belong to.",
      keywords: ["profile", "account", "name", "timezone", "language", "spaces", "preferences"],
    },
    {
      title: "Geral",
      description: "Seu nome, e-mail, fuso horário e os espaços de que você faz parte.",
      keywords: ["perfil", "conta", "nome", "fuso", "idioma", "espaços", "preferências"],
    },
  ),
  screen(
    "settings-models",
    "/settings/models",
    "member",
    ALL,
    {
      title: "Models",
      description: "Connect an AI provider or subscription and choose the models agents use.",
      keywords: [
        "model",
        "provider",
        "api key",
        "openai",
        "anthropic",
        "claude",
        "gpt",
        "llm",
        "local",
        "ollama",
        "subscription",
      ],
    },
    {
      title: "Modelos",
      description: "Conecte um provedor ou assinatura de IA e escolha os modelos dos agentes.",
      keywords: [
        "modelo",
        "provedor",
        "chave de api",
        "openai",
        "anthropic",
        "claude",
        "gpt",
        "llm",
        "local",
        "ollama",
        "assinatura",
      ],
    },
  ),
  screen(
    "settings-voice",
    "/settings/voice",
    "member",
    ALL,
    {
      title: "Voice",
      description: "Speech: talking to agents, reading replies aloud and phone calls.",
      keywords: ["speech", "talk", "microphone", "read aloud", "call", "dictation", "tts"],
    },
    {
      title: "Voz",
      description: "Fala: conversar com agentes, ouvir respostas em voz alta e ligações.",
      keywords: ["fala", "falar", "microfone", "ler em voz alta", "ligação", "ditado"],
    },
  ),
  screen(
    "settings-approvals",
    "/settings/approvals",
    "member",
    ALL,
    {
      title: "Approvals",
      description: "Rules for which agent actions run on their own and which ask first.",
      keywords: ["rules", "auto approve", "permissions", "ask first", "autonomy", "safety"],
    },
    {
      title: "Aprovações",
      description: "Regras de quais ações dos agentes rodam sozinhas e quais pedem antes.",
      keywords: ["regras", "aprovar automaticamente", "permissões", "perguntar antes", "autonomia"],
    },
  ),
  screen(
    "settings-memory",
    "/settings/memory",
    "member",
    COMPUTER,
    {
      title: "Memory",
      description: "How agents remember: where memory is kept and what they may recall.",
      keywords: ["remember", "recall", "forget", "knowledge", "provider", "context"],
    },
    {
      title: "Memória",
      description: "Como os agentes lembram: onde a memória fica e o que podem recordar.",
      keywords: ["lembrar", "recordar", "esquecer", "conhecimento", "provedor", "contexto"],
    },
  ),
  screen(
    "settings-members",
    "/settings/members",
    "owner",
    COMPUTER,
    {
      title: "Members",
      description: "Invite people to the space and manage their roles and access.",
      keywords: ["invite", "people", "users", "roles", "permissions", "teammates", "remove", "add"],
    },
    {
      title: "Membros",
      description: "Convide pessoas para o espaço e gerencie seus papéis e acessos.",
      keywords: ["convidar", "pessoas", "usuários", "papéis", "permissões", "colegas", "remover"],
    },
  ),
  screen(
    "settings-usage",
    "/settings/usage",
    "member",
    COMPUTER,
    {
      title: "Usage",
      description: "What was used over a period, by agent, with tokens and cost.",
      keywords: ["cost", "tokens", "spend", "credits", "limits", "quota", "bill"],
    },
    {
      title: "Uso",
      description: "O que foi usado em um período, por agente, com tokens e custo.",
      keywords: ["custo", "tokens", "gasto", "créditos", "limites", "cota"],
    },
  ),
  screen(
    "settings-connections",
    "/settings/connections",
    "member",
    ALL,
    {
      title: "Connections",
      description:
        "Connect apps and servers (Gmail, Notion, GitHub, MCP), databases and mailboxes for agents to use.",
      keywords: [
        "connect",
        "integration",
        "app",
        "mcp",
        "server",
        "oauth",
        "database",
        "mailbox",
        "email",
        "link account",
        "plug",
      ],
    },
    {
      title: "Conexões",
      description:
        "Conecte apps e servidores (Gmail, Notion, GitHub, MCP), bancos de dados e caixas de e-mail para os agentes usarem.",
      keywords: [
        "conectar",
        "integração",
        "app",
        "mcp",
        "servidor",
        "oauth",
        "banco de dados",
        "caixa de e-mail",
        "email",
        "vincular conta",
      ],
    },
  ),
  screen(
    "settings-mcp-access",
    "/settings/mcp-access",
    "member",
    ALL,
    {
      title: "MCP",
      description:
        "Make keys that let Claude Code, Codex, Cursor or another MCP client talk to your agents, and revoke them.",
      keywords: ["mcp", "claude code", "codex", "cursor"],
    },
    {
      title: "MCP",
      description:
        "Crie chaves para o Claude Code, Codex, Cursor ou outro cliente MCP conversar com seus agentes, e revogue-as.",
      keywords: ["mcp", "claude code", "codex", "cursor"],
    },
  ),
  screen(
    "settings-vault",
    "/settings/vault",
    "member",
    ALL,
    {
      title: "Vault",
      description:
        "Every saved credential in one place: which agents can use it, and when it was last used.",
      keywords: ["credential", "api key", "secret", "password", "login", "token", "access"],
    },
    {
      title: "Cofre",
      description:
        "Todas as credenciais salvas em um só lugar: quais agentes podem usar cada uma e quando foi usada pela última vez.",
      keywords: ["credencial", "chave de api", "segredo", "senha", "login", "token", "acesso"],
    },
  ),
  screen(
    "settings-computer",
    "/settings/computer",
    "owner",
    COMPUTER,
    {
      title: "Computer",
      description: "The sandbox or computer agents use to browse, run code and handle files.",
      keywords: ["sandbox", "browser", "vm", "desktop", "shell", "code", "provider"],
    },
    {
      title: "Computador",
      description:
        "O sandbox ou computador que os agentes usam para navegar, rodar código e lidar com arquivos.",
      keywords: ["sandbox", "navegador", "vm", "área de trabalho", "terminal", "código"],
    },
  ),
  screen(
    "settings-billing",
    "/settings/billing",
    "owner",
    COMPUTER,
    {
      title: "Billing",
      description: "Your plan, payment method, invoices and credits: upgrade, change or cancel.",
      keywords: [
        "plan",
        "subscription",
        "upgrade",
        "downgrade",
        "change plan",
        "cancel",
        "payment",
        "card",
        "invoice",
        "credits",
        "pricing",
      ],
    },
    {
      title: "Cobrança",
      description:
        "Seu plano, forma de pagamento, faturas e créditos: fazer upgrade, trocar ou cancelar.",
      keywords: [
        "plano",
        "assinatura",
        "upgrade",
        "downgrade",
        "trocar plano",
        "cancelar",
        "pagamento",
        "cartão",
        "fatura",
        "créditos",
        "preço",
      ],
    },
  ),
  screen(
    "settings-updates",
    "/settings/updates",
    "member",
    ["desktop"],
    {
      title: "Updates",
      description: "Check for and install a new version of the desktop app.",
      keywords: ["update", "upgrade", "version", "release", "install", "desktop"],
    },
    {
      title: "Atualizações",
      description: "Veja e instale uma nova versão do aplicativo de computador.",
      keywords: ["atualizar", "versão", "lançamento", "instalar", "desktop"],
    },
  ),
];
