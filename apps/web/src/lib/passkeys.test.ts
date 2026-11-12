import { describe, expect, it, vi } from "vitest";
import { conditionalPasskeyAvailable, passkeyErrorText, passkeysSupported } from "./passkeys";

function browser(host: string, available: boolean | Error = true) {
  return {
    host,
    credential: {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn(async () => {
        if (available instanceof Error) throw available;
        return available;
      }),
    },
  };
}

describe("passkeysSupported", () => {
  it("needs WebAuthn, a matching relying party, and a platform authenticator", async () => {
    await expect(passkeysSupported("localhost", browser("localhost"))).resolves.toBe(true);
    await expect(passkeysSupported("example.test", browser("app.example.test"))).resolves.toBe(
      true,
    );
    await expect(passkeysSupported("localhost", { host: "localhost" })).resolves.toBe(false);
    await expect(passkeysSupported(null, browser("localhost"))).resolves.toBe(false);
    await expect(passkeysSupported(undefined, browser("localhost"))).resolves.toBe(false);
    await expect(passkeysSupported("localhost", browser("127.0.0.1"))).resolves.toBe(false);
    await expect(passkeysSupported("example.test", browser("evil-example.test"))).resolves.toBe(
      false,
    );
  });

  it("hides passkeys when no platform authenticator is ready, as in Electron on macOS", async () => {
    await expect(passkeysSupported("localhost", browser("localhost", false))).resolves.toBe(false);
    await expect(
      passkeysSupported("localhost", browser("localhost", new Error("blocked"))),
    ).resolves.toBe(false);
  });

  it("on the macOS app, offers passkeys only for relying parties the build is associated with", async () => {
    const mac = (rpIds?: string[] | Error) => ({
      ...browser("app.rook.team"),
      desktop: {
        platform: "darwin",
        passkeys:
          rpIds === undefined
            ? undefined
            : {
                rpIds: vi.fn(async () => {
                  if (rpIds instanceof Error) throw rpIds;
                  return rpIds;
                }),
              },
      },
    });
    await expect(passkeysSupported("app.rook.team", mac(["app.rook.team"]))).resolves.toBe(true);
    await expect(passkeysSupported("App.Rook.Team", mac(["app.rook.team"]))).resolves.toBe(true);
    await expect(passkeysSupported("app.rook.team", mac([]))).resolves.toBe(false);
    await expect(passkeysSupported("app.rook.team", mac())).resolves.toBe(false);
    await expect(passkeysSupported("app.rook.team", mac(new Error("ipc")))).resolves.toBe(false);
    // Passkeys made on the previous domain stay usable from the new one through related origins.
    const rpId = "app.rookup.run";
    const related = ["https://app.rook.team"];
    await expect(passkeysSupported(rpId, mac([rpId]), related)).resolves.toBe(true);
    await expect(passkeysSupported(rpId, mac([rpId]))).resolves.toBe(false);
    await expect(passkeysSupported(rpId, mac(["app.rook.team"]), related)).resolves.toBe(false);
    const selfHosted = { ...mac(["app.rook.team"]), host: "corvo.example.com" };
    await expect(passkeysSupported("corvo.example.com", selfHosted)).resolves.toBe(false);
    expect(
      selfHosted.credential.isUserVerifyingPlatformAuthenticatorAvailable,
    ).not.toHaveBeenCalled();
  });

  it("leaves other desktop platforms to their own platform authenticator", async () => {
    const windows = { ...browser("corvo.example.com"), desktop: { platform: "win32" } };
    await expect(passkeysSupported("corvo.example.com", windows)).resolves.toBe(true);
  });

  it("does not ask the authenticator when the host cannot use the relying party", async () => {
    const other = browser("127.0.0.1");
    await passkeysSupported("localhost", other);
    expect(other.credential.isUserVerifyingPlatformAuthenticatorAvailable).not.toHaveBeenCalled();
  });
});

describe("conditionalPasskeyAvailable", () => {
  it("never starts autofill in the macOS app, whose passkey sheet is modal", async () => {
    vi.stubGlobal("PublicKeyCredential", {
      isConditionalMediationAvailable: vi.fn(async () => true),
    });
    try {
      await expect(conditionalPasskeyAvailable({ platform: "darwin" })).resolves.toBe(false);
      await expect(conditionalPasskeyAvailable({ platform: "win32" })).resolves.toBe(true);
      await expect(conditionalPasskeyAvailable(undefined)).resolves.toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("passkeyErrorText", () => {
  it("stays silent when the user closes the dialog", () => {
    for (const code of [
      "AUTH_CANCELLED",
      "ERROR_CEREMONY_ABORTED",
      "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
    ]) {
      expect(passkeyErrorText({ code, message: "The operation was aborted" }, "Fallback")).toBe(
        null,
      );
    }
  });

  it("asks for a fresh sign-in and hides browser detail", () => {
    expect(passkeyErrorText({ code: "SESSION_NOT_FRESH" }, "Fallback")).toBe("Sign in again");
    expect(
      passkeyErrorText(
        { code: "ERROR_INVALID_RP_ID", message: 'The RP ID "x" is invalid for this domain' },
        "Fallback",
      ),
    ).toBe("Fallback");
  });

  it("uses the shared auth error copy for server gates", () => {
    expect(passkeyErrorText({ code: "REGISTRATION_CLOSED" }, "Fallback")).toBe(
      "Registration is closed",
    );
    expect(passkeyErrorText({ code: "EMAIL_VERIFICATION_REQUIRED" }, "Fallback")).toBe(
      "Email verification required",
    );
  });
});
