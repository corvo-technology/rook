import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const group = (label, en, directory) => ({
  label,
  translations: { en },
  items: [{ autogenerate: { directory } }],
});

export default defineConfig({
  site: "https://docs.rook.team",
  output: "static",
  server: { host: "127.0.0.1", port: 4322 },
  preview: { host: "0.0.0.0", port: 4322 },
  integrations: [
    starlight({
      title: { "pt-BR": "Rook Docs", en: "Rook Docs" },
      description:
        "Como usar o Rook e como integrá-lo como parceiro: agentes, canais, rotinas, aprovações, memória e a API de parceiros.",
      logo: { src: "./src/assets/logo.svg", alt: "Rook" },
      favicon: "/favicon.svg",
      defaultLocale: "root",
      locales: {
        root: { label: "Português", lang: "pt-BR" },
        en: { label: "English", lang: "en" },
      },
      lastUpdated: false,
      customCss: ["./src/styles/theme.css"],
      components: { Hero: "./src/components/Hero.astro" },
      head: [
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
        },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
          },
        },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
        {
          tag: "link",
          attrs: { rel: "alternate", type: "text/plain", href: "/llms.txt", title: "llms.txt" },
        },
      ],
      sidebar: [
        group("Introdução", "Introduction", "intro"),
        group("Começando", "Getting started", "start"),
        group("Agentes", "Agents", "agents"),
        group("Parceiros", "Partners", "partners"),
        group("Segurança e privacidade", "Security and privacy", "security"),
      ],
    }),
  ],
});
