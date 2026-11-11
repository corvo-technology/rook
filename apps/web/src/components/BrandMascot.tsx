import { mascotHex } from "@corvo/core";
import { BotAvatar } from "@corvo/ui-web";

/** The mint rook, for the places that introduce the app. */
export function BrandMascot({ size, className }: { size: number; className?: string }) {
  return <BotAvatar color={mascotHex("mint")} identity="corvo" size={size} className={className} />;
}
