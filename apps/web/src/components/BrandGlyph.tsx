import { RookGlyph } from "@corvo/ui-web";
import type { ComponentProps } from "react";
import { useBrand } from "../lib/brand";

/**
 * The app's mark in loading and empty moments. On a partner's host it is the partner's icon, or a
 * neutral dot when it has none: Rook's mark never shows there.
 */
export function BrandGlyph({ size = 28, className, ...rest }: ComponentProps<typeof RookGlyph>) {
  const brand = useBrand();
  if (!brand) return <RookGlyph size={size} className={className} {...rest} />;
  return brand.iconUrl ? (
    <img
      src={brand.iconUrl}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-full bg-muted ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}
