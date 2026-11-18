import type { PartnersCopy } from "./types";

const es: PartnersCopy = {
  path: "/es/socios",
  link: "Socios",
  meta: {
    title: "Socios · Rook",
    description:
      "Ofrece agentes de IA con tu marca: dentro de tu producto o como marca blanca. Comisión recurrente por cliente, más tu propio margen.",
  },
  hero: {
    title: "Ofrece agentes de IA con tu marca",
    lead: "Lleva Rook a tu producto o véndelo como tu propia plataforma. Ganas con cada cliente, cada mes.",
    cta: "Quiero ser socio",
    docs: "Documentación técnica",
  },
  modes: {
    heading: "Dos formas de ser socio",
    items: [
      {
        who: "Productos SaaS",
        title: "Integrado en tu producto",
        body: "Para sistemas de clínicas, barberías o salones. Los agentes viven dentro de tu producto y se conectan a tus datos por MCP.",
      },
      {
        who: "Agencias y revendedores",
        title: "Marca blanca",
        body: "Para agencias y revendedores. Rook funciona con tu marca, en tu dominio y con tus precios.",
      },
    ],
  },
  earn: {
    heading: "Cómo ganas",
    lead: "Una comisión recurrente sobre la suscripción de cada cliente, más tu propio margen encima. El margen es todo tuyo.",
    exampleLabel: "Ejemplo ilustrativo",
    price: "El cliente paga",
    commission: "Comisión",
    markup: "Tu margen",
    total: "Tú recibes",
    note: "Los porcentajes se configuran por socio y este ejemplo usa 20%. Cifras solo ilustrativas, sin condiciones contractuales.",
  },
  included: {
    heading: "Lo que ya viene listo",
    items: [
      { title: "Agentes listos por vertical", body: "Plantillas para clínicas, barberías, salones y más, con las rutinas del día a día." },
      { title: "SDK para integrar", body: "Rook dentro de tu producto, con tu login y tu estilo." },
      { title: "API de socios", body: "Crea clientes, define límites y sigue el uso desde código." },
      { title: "Grabación de consultas", body: "Para clínicas: el agente transcribe la consulta y prepara el borrador del historial." },
      { title: "Crédito por cliente", body: "Controla cuánto puede gastar cada cliente y recarga cuando haga falta." },
      { title: "Webhooks", body: "Recibe un aviso cuando se acaba el crédito o pasa algo importante." },
      { title: "Datos aislados", body: "Cada cliente en su propio espacio, separado de los demás." },
      { title: "LGPD", body: "Tratamiento de datos personales pensado desde el inicio para la ley brasileña." },
    ],
  },
  proof: {
    heading: "Ya funciona en productos reales",
    body: "Una familia de sistemas verticales para clínicas, barberías y salones usa Rook integrado. Los agentes atienden, agendan y registran, conectados a los datos de cada cliente.",
  },
  how: {
    heading: "Cómo funciona",
    steps: [
      { title: "Habla con nosotros", body: "Cuéntanos sobre tu producto y tus clientes. Respondemos en pocos días." },
      { title: "Prepara tu plantilla", body: "Elegimos juntos los agentes, los límites y los precios." },
      { title: "Integra", body: "Intégralo con el SDK o lanza tu marca blanca." },
      { title: "Vende", body: "Tus clientes se suscriben y tú cobras cada mes." },
    ],
  },
  faq: {
    heading: "Preguntas",
    items: [
      { question: "¿Necesito programar?", answer: "Para integrar en tu producto, sí: el SDK y la API son para tu equipo técnico. La marca blanca no requiere código." },
      { question: "¿Quién da soporte a mis clientes?", answer: "Tú estás en primera línea y nosotros te respaldamos. Lo acordamos en la primera conversación." },
      { question: "¿Los datos de mis clientes quedan separados?", answer: "Sí. Cada cliente tiene su espacio aislado y los agentes solo acceden a lo que conectes." },
      { question: "¿Cuánto cuesta empezar?", answer: "Hablamos del modelo que encaja con tu negocio. El formulario no genera ningún compromiso." },
      { question: "¿Puedo usar mi dominio y mi marca?", answer: "Sí. En marca blanca, Rook aparece con tu marca, en tu dominio y con tus precios." },
    ],
  },
  form: {
    heading: "Quiero ser socio",
    name: "Nombre",
    email: "Correo de trabajo",
    company: "Empresa",
    website: "Sitio web",
    type: "Cómo quieres ser socio",
    types: { embedded: "Integrado en mi producto", white_label: "Marca blanca", unsure: "Aún no lo sé" },
    country: "País",
    customers: "Cuántos clientes tienes",
    customerRanges: ["Hasta 50", "50 a 200", "200 a 1.000", "Más de 1.000"],
    message: "Mensaje",
    consent: "Acepto que me contacten sobre el programa de socios y el tratamiento de mis datos para ello.",
    submit: "Enviar",
    successTitle: "Recibimos tu mensaje.",
    success: "Enviamos un correo a {email}. Te escribiremos pronto.",
    error: "No pudimos enviarlo ahora. Inténtalo de nuevo en un momento.",
    requiredError: "Completa este campo.",
    emailError: "Escribe un correo válido.",
    consentError: "Necesitamos tu consentimiento para continuar.",
  },
};

export default es;
