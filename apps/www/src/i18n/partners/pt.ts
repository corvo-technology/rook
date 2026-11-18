import type { PartnersCopy } from "./types";

const pt: PartnersCopy = {
  path: "/parceiros",
  link: "Parceiros",
  meta: {
    title: "Parceiros · Rook",
    description:
      "Ofereça agentes de IA com a sua marca: dentro do seu produto ou como white label. Comissão recorrente por cliente, mais a sua margem.",
  },
  hero: {
    title: "Ofereça agentes de IA com a sua marca",
    lead: "Leve o Rook para dentro do seu produto ou venda como a sua própria plataforma. Você ganha a cada cliente, todo mês.",
    cta: "Quero ser parceiro",
    docs: "Documentação técnica",
  },
  modes: {
    heading: "Dois jeitos de ser parceiro",
    items: [
      {
        who: "Sistemas SaaS",
        title: "Embutido no seu produto",
        body: "Para sistemas de clínica, barbearia ou salão. Os agentes vivem dentro do seu produto e se conectam aos seus dados por MCP.",
      },
      {
        who: "Agências e revendas",
        title: "White label",
        body: "Para agências e revendedores. O Rook roda com a sua marca, no seu domínio e com os seus preços.",
      },
    ],
  },
  earn: {
    heading: "Como você ganha",
    lead: "Uma comissão recorrente sobre a assinatura de cada cliente, mais a sua própria margem por cima. A margem fica toda com você.",
    exampleLabel: "Exemplo ilustrativo",
    price: "O cliente paga",
    commission: "Comissão",
    markup: "Sua margem",
    total: "Você recebe",
    note: "Os percentuais são configuráveis por parceiro e este exemplo usa 20%. Valores só para ilustrar, sem condições contratuais.",
  },
  included: {
    heading: "O que já vem pronto",
    items: [
      { title: "Agentes prontos por vertical", body: "Modelos para clínica, barbearia, salão e mais, já com as rotinas do dia a dia." },
      { title: "SDK para embutir", body: "O Rook dentro do seu produto, com o seu login e a sua cara." },
      { title: "API de parceiro", body: "Crie clientes, defina limites e acompanhe o uso por código." },
      { title: "Gravação de consultas", body: "Para clínicas: o agente transcreve e organiza a consulta em um rascunho de prontuário." },
      { title: "Crédito por cliente", body: "Controle quanto cada cliente pode gastar, e recarregue quando precisar." },
      { title: "Webhooks", body: "Seja avisado quando o crédito acaba ou algo importante acontece." },
      { title: "Dados isolados", body: "Cada cliente no seu espaço, separado dos outros." },
      { title: "LGPD", body: "Tratamento de dados pessoais pensado desde o início para a lei brasileira." },
    ],
  },
  proof: {
    heading: "Já funciona em produtos reais",
    body: "Uma família de sistemas verticais, para clínicas, barbearias e salões, usa o Rook embutido. Os agentes atendem, agendam e registram, conectados aos dados de cada cliente.",
  },
  how: {
    heading: "Como funciona",
    steps: [
      { title: "Fale com a gente", body: "Conte o seu produto e os seus clientes. Respondemos em poucos dias." },
      { title: "Monte o seu modelo", body: "Escolhemos juntos os agentes, os limites e os preços." },
      { title: "Integre", body: "Embuta com o SDK ou lance o seu white label." },
      { title: "Venda", body: "Seus clientes assinam e você recebe todo mês." },
    ],
  },
  faq: {
    heading: "Perguntas",
    items: [
      { question: "Preciso saber programar?", answer: "Para embutir no seu produto, sim: o SDK e a API são para o seu time técnico. O white label dispensa código." },
      { question: "Quem cuida do suporte aos meus clientes?", answer: "Você fica na linha de frente e conta com a gente por trás. Combinamos isso na conversa inicial." },
      { question: "Os dados dos meus clientes ficam separados?", answer: "Ficam. Cada cliente tem o seu espaço isolado, e os agentes só acessam o que você conectar." },
      { question: "Quanto custa para começar?", answer: "Conversamos sobre o modelo que combina com o seu negócio. O formulário não cria nenhum compromisso." },
      { question: "Posso usar o meu domínio e a minha marca?", answer: "Pode. No white label, o Rook aparece com a sua marca, no seu domínio e com os seus preços." },
    ],
  },
  form: {
    heading: "Quero ser parceiro",
    name: "Nome",
    email: "E-mail de trabalho",
    company: "Empresa",
    website: "Site",
    type: "Como você quer ser parceiro",
    types: { embedded: "Embutido no meu produto", white_label: "White label", unsure: "Ainda não sei" },
    country: "País",
    customers: "Quantos clientes você tem",
    customerRanges: ["Até 50", "50 a 200", "200 a 1.000", "Mais de 1.000"],
    message: "Mensagem",
    consent: "Concordo em ser contatado sobre o programa de parceiros e com o tratamento dos meus dados para isso.",
    submit: "Enviar",
    successTitle: "Recebemos o seu contato.",
    success: "Mandamos um e-mail para {email}. Vamos escrever de volta em breve.",
    error: "Não foi possível enviar agora. Tente de novo em instantes.",
    requiredError: "Preencha este campo.",
    emailError: "Digite um e-mail válido.",
    consentError: "Precisamos do seu consentimento para continuar.",
  },
};

export default pt;
