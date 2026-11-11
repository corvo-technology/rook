# App icon source

`Corvo.icon` is the shared editable source for macOS and iOS. Open it in Apple's
Icon Composer with Xcode 26 or newer. is the mint rook, drawn as `Assets/ana.svg` and centered on the system dark
background. The same drawing is the site's logo.

macOS packaging compiles the source into a Tahoe asset catalog and generates the
legacy ICNS fallback. Expo copies the same source into the iOS project.

The platform exports are:

- `apps/desktop/assets/icon-macos.png`: 1024-pixel macOS pre-Tahoe export on a rounded plate,
  including Dock margins for development launches; `icon.icns` is built from it with `iconutil`.
- `apps/mobile/assets/icon.png`: opaque 1024-pixel square for the generic/legacy icon,
  with no rounded mask or Dock margins.
- `apps/mobile/assets/adaptive-icon.png`: transparent 1024-pixel Android foreground;
  The rook's view box is half the canvas, centered, so the whole figure stays inside the launcher's
  safe circle.
- `apps/mobile/assets/icon-background.png`: opaque Android background using the
  shared dark background token.
- `apps/mobile/assets/monochrome-icon.png`: matching Android alpha silhouette with
  transparent eyes for themed launchers.

Refresh platform exports after changing the source. Android supplies its own mask;
never bake Mac corners, a rim, or an outer shadow into adaptive layers.

Run `pnpm --filter @corvo/ui-tokens export:brand` to refresh every icon from `ana.svg`: the
web favicons and install icons, the Windows/Linux and macOS icons, the Android icon layers,
the mobile splash and the mobile web favicon. The marketing site keeps its own set under
`apps/www/public/brand`, drawn from the same logo. These use the shared dark
background, a rounded mask for small browser marks, and transparent splash padding.
The notification export uses the Android monochrome silhouette so its eyes remain
transparent. Apple Icon Composer and Android launcher exports remain separate
because their system masks and safe areas differ.

After exporting, run `pnpm exec tsx apps/www/scripts/render-og.mjs` to refresh the
marketing page social cards; set `CHROME_PATH` to a headless Chrome executable when
it is not available at the script's default location.
