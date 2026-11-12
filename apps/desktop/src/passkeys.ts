import path from "node:path";
import { CORVO_CLOUD_URL, LEGACY_CLOUD_URL } from "./setup-config.js";

/**
 * Relying parties release builds are associated with (`webcredentials:` entitlements). Passkeys
 * are bound to the relying party they were made for, so the old hosted domain stays listed next to
 * the new one: an existing passkey keeps working, and so does an app still saved on the old address.
 */
export const PASSKEY_RP_IDS = [CORVO_CLOUD_URL, LEGACY_CLOUD_URL].map(
  (url) => new URL(url).hostname,
);

/**
 * Relying parties whose passkeys this build can use through the system passkey sheet. The
 * release workflow embeds a provisioning profile only together with the `webcredentials:`
 * entitlement, and macOS ignores that entitlement without one, so the profile is the signal.
 */
export function associatedPasskeyRpIds(input: {
  platform: NodeJS.Platform;
  packaged: boolean;
  resourcesPath: string;
  exists: (file: string) => boolean;
}): string[] {
  if (input.platform !== "darwin" || !input.packaged) return [];
  const profile = path.join(input.resourcesPath, "..", "embedded.provisionprofile");
  return input.exists(profile) ? [...PASSKEY_RP_IDS] : [];
}

const TEAM_ID = /^[A-Z0-9]{10}$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** Adds the passkey association to the app's base entitlements for a release signed by `teamId`. */
export function passkeyEntitlements(base: string, teamId: string, bundleId: string): string {
  if (!TEAM_ID.test(teamId))
    throw new Error("Apple Team ID must be 10 uppercase letters or digits");
  if (!BUNDLE_ID.test(bundleId)) throw new Error("Invalid bundle identifier");
  const end = base.lastIndexOf("</dict>");
  if (end === -1 || base.includes("com.apple.developer.associated-domains")) {
    throw new Error("Unexpected base entitlements");
  }
  const entries = [
    "    <!-- System passkeys (app.configureWebAuthn); requires the embedded provisioning profile. -->",
    "    <key>com.apple.application-identifier</key>",
    `    <string>${teamId}.${bundleId}</string>`,
    "    <key>com.apple.developer.associated-domains</key>",
    "    <array>",
    ...PASSKEY_RP_IDS.map((rpId) => `      <string>webcredentials:${rpId}</string>`),
    "    </array>",
  ];
  return `${base.slice(0, end).trimEnd()}\n${entries.join("\n")}\n  ${base.slice(end)}`;
}
