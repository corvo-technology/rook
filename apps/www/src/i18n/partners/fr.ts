import type { PartnersCopy } from "./types";

const fr: PartnersCopy = {
  path: "/fr/partenaires",
  link: "Partenaires",
  meta: {
    title: "Partenaires · Rook",
    description:
      "Proposez des agents IA sous votre marque : intégrés à votre produit ou en marque blanche. Une commission récurrente par client, plus votre propre marge.",
  },
  hero: {
    title: "Proposez des agents IA sous votre marque",
    lead: "Intégrez Rook à votre produit ou vendez-le comme votre propre plateforme. Vous gagnez sur chaque client, chaque mois.",
    cta: "Devenir partenaire",
    docs: "Documentation technique",
  },
  modes: {
    heading: "Deux façons de devenir partenaire",
    items: [
      {
        who: "Produits SaaS",
        title: "Intégré à votre produit",
        body: "Pour les logiciels de cliniques, de barbiers ou de salons. Les agents vivent dans votre produit et se connectent à vos données via MCP.",
      },
      {
        who: "Agences et revendeurs",
        title: "Marque blanche",
        body: "Pour les agences et les revendeurs. Rook fonctionne sous votre marque, sur votre domaine, à vos tarifs.",
      },
    ],
  },
  earn: {
    heading: "Comment vous gagnez",
    lead: "Une commission récurrente sur l'abonnement de chaque client, plus votre propre marge par-dessus. La marge vous revient entièrement.",
    exampleLabel: "Exemple illustratif",
    price: "Le client paie",
    commission: "Commission",
    markup: "Votre marge",
    total: "Vous touchez",
    note: "Les pourcentages sont configurables par partenaire ; cet exemple retient 20 %. Chiffres illustratifs, sans valeur contractuelle.",
  },
  included: {
    heading: "Ce qui est déjà prêt",
    items: [
      { title: "Agents prêts par secteur", body: "Des modèles pour cliniques, barbiers, salons et plus, avec les routines du quotidien." },
      { title: "SDK d'intégration", body: "Rook dans votre produit, avec votre connexion et votre style." },
      { title: "API partenaire", body: "Créez des clients, fixez des limites et suivez l'usage par code." },
      { title: "Enregistrement des consultations", body: "Pour les cliniques : l'agent transcrit la consultation et prépare un brouillon de dossier." },
      { title: "Crédit par client", body: "Contrôlez ce que chaque client peut dépenser et rechargez au besoin." },
      { title: "Webhooks", body: "Soyez prévenu quand le crédit s'épuise ou qu'un événement important survient." },
      { title: "Données isolées", body: "Chaque client dans son propre espace, séparé des autres." },
      { title: "LGPD", body: "Un traitement des données personnelles conçu dès le départ pour la loi brésilienne." },
    ],
  },
  proof: {
    heading: "Déjà en service dans des produits réels",
    body: "Une famille de produits verticaux pour cliniques, barbiers et salons utilise Rook en intégration. Les agents répondent, planifient et consignent, reliés aux données de chaque client.",
  },
  how: {
    heading: "Comment ça marche",
    steps: [
      { title: "Parlez-nous", body: "Présentez votre produit et vos clients. Nous répondons sous quelques jours." },
      { title: "Préparez votre modèle", body: "Nous choisissons ensemble les agents, les limites et les prix." },
      { title: "Intégrez", body: "Intégrez avec le SDK ou lancez votre marque blanche." },
      { title: "Vendez", body: "Vos clients s'abonnent et vous êtes payé chaque mois." },
    ],
  },
  faq: {
    heading: "Questions",
    items: [
      { question: "Faut-il savoir programmer ?", answer: "Pour intégrer à votre produit, oui : le SDK et l'API s'adressent à votre équipe technique. La marque blanche n'exige aucun code." },
      { question: "Qui assure le support de mes clients ?", answer: "Vous restez en première ligne et nous vous épaulons. Nous en convenons lors du premier échange." },
      { question: "Les données de mes clients sont-elles séparées ?", answer: "Oui. Chaque client dispose d'un espace isolé et les agents n'accèdent qu'à ce que vous connectez." },
      { question: "Combien coûte le démarrage ?", answer: "Nous discutons du modèle adapté à votre activité. Le formulaire n'engage à rien." },
      { question: "Puis-je utiliser mon domaine et ma marque ?", answer: "Oui. En marque blanche, Rook apparaît sous votre marque, sur votre domaine, à vos tarifs." },
    ],
  },
  form: {
    heading: "Devenir partenaire",
    name: "Nom",
    email: "E-mail professionnel",
    company: "Entreprise",
    website: "Site web",
    type: "Comment souhaitez-vous collaborer",
    types: { embedded: "Intégré à mon produit", white_label: "Marque blanche", unsure: "Je ne sais pas encore" },
    country: "Pays",
    customers: "Combien de clients avez-vous",
    customerRanges: ["Jusqu'à 50", "50 à 200", "200 à 1 000", "Plus de 1 000"],
    message: "Message",
    consent: "J'accepte d'être contacté au sujet du programme partenaire et du traitement de mes données à cette fin.",
    submit: "Envoyer",
    successTitle: "Nous avons bien reçu votre message.",
    success: "Un e-mail a été envoyé à {email}. Nous vous répondrons bientôt.",
    error: "Envoi impossible pour le moment. Réessayez dans un instant.",
    requiredError: "Renseignez ce champ.",
    emailError: "Saisissez un e-mail valide.",
    consentError: "Nous avons besoin de votre consentement pour continuer.",
  },
};

export default fr;
