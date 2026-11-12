import type { Hono } from "hono";

/** Package of the Rook Android app (apps/mobile/app.json). */
const ANDROID_PACKAGE = "tech.corvo.bots.mobile";

/**
 * Which native apps can use this server's passkeys: only those the domain vouches for
 * below. Without the association file the OS refuses every ceremony, so apps hide passkeys.
 */
export function nativePasskeys(
  env: { passkeyAppleAppIds: string[]; passkeyAndroidCertFingerprints: string[] },
  passkeyRpId: string | null,
): { ios: boolean; android: boolean } {
  return {
    ios: Boolean(passkeyRpId) && env.passkeyAppleAppIds.length > 0,
    android: Boolean(passkeyRpId) && env.passkeyAndroidCertFingerprints.length > 0,
  };
}

/**
 * Domain association files that let the native apps use this domain's
 * passkeys. Each file exists only when the deployment names its apps.
 */
export function mountAppAssociation(
  app: Hono,
  env: {
    passkeyAppleAppIds: string[];
    passkeyAndroidCertFingerprints: string[];
    passkeyRelatedOrigins?: string[];
  },
) {
  // WebAuthn related origin requests: browsers read this from the relying party's host to let
  // another origin use its passkeys, so a moved deployment keeps the passkeys made before the move.
  app.get("/.well-known/webauthn", (c) => {
    if (!env.passkeyRelatedOrigins?.length) return c.notFound();
    return c.json({ origins: env.passkeyRelatedOrigins });
  });
  app.get("/.well-known/apple-app-site-association", (c) => {
    if (!env.passkeyAppleAppIds.length) return c.notFound();
    return c.json({ webcredentials: { apps: env.passkeyAppleAppIds } });
  });
  app.get("/.well-known/assetlinks.json", (c) => {
    if (!env.passkeyAndroidCertFingerprints.length) return c.notFound();
    return c.json([
      {
        relation: ["delegate_permission/common.get_login_creds"],
        target: {
          namespace: "android_app",
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: env.passkeyAndroidCertFingerprints,
        },
      },
    ]);
  });
}
