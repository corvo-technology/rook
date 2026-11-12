import { MASCOT_LOOKS } from "@corvo/core";

/** The rooks, one per agent color the app has, in the order its picker shows them. */
export const MASCOT_HUES = [
  "menta",
  "azul",
  "violeta",
  "rosa",
  "vermelho",
  "laranja",
  "amarelo",
  "lima",
  "ciano",
  "neutro",
] as const;

export type MascotHue = (typeof MASCOT_HUES)[number];

/** The one color each rook wears. */
export const MASCOT_COLOR: Record<MascotHue, string> = {
  menta: "#54c398",
  azul: "#75aef5",
  violeta: "#b797ef",
  rosa: "#e788b6",
  vermelho: "#f48877",
  laranja: "#e59651",
  amarelo: "#cda448",
  lima: MASCOT_LOOKS.lime.color,
  ciano: "#4bbdcf",
  neutro: "#55555c",
};
