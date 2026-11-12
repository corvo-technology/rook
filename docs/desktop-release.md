# Desktop releases

The `release-desktop` workflow builds, signs, notarizes, attests, and publishes
the Electron app from a `vMAJOR.MINOR.PATCH` tag on `main`. Publishing the
Docker images triggers from the same tag.

## Repository secrets

macOS (required):

| Secret | Value |
| --- | --- |
| `DESKTOP_MAC_CSC_LINK` | Base64 of the `Developer ID Application` certificate exported as `.p12` |
| `DESKTOP_MAC_CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_API_KEY_ID` | App Store Connect API key ID (the `XXXXXXXXXX` in `AuthKey_XXXXXXXXXX.p8`) |
| `APPLE_API_ISSUER` | Issuer ID shown on App Store Connect > Users and Access > Integrations |
| `APPLE_API_KEY_P8` | Contents of the `AuthKey_*.p8` file |

The API key needs the Developer role. The workflow writes it to a mode 600 file
in the runner's temp directory for the packaging step and deletes it afterwards.

`patches/app-builder-lib@26.15.3.patch` carries electron-builder PR #10101:
without it `CSC_LINK` signing fails while creating the temporary keychain. Drop
the patch once an electron-builder release includes that fix.

Windows (optional):

| Secret | Value |
| --- | --- |
| `DESKTOP_WIN_CSC_LINK` | Base64 of the Authenticode certificate as `.p12`/`.pfx` |
| `DESKTOP_WIN_CSC_KEY_PASSWORD` | Its password |

When `DESKTOP_WIN_CSC_LINK` is unset the Windows build and its release assets
are skipped. macOS and Linux always build, and the release is only published
when every platform that was built produced its installer and update feed.

Set a secret from a file without echoing it:

```sh
base64 -i devid.p12 | gh secret set DESKTOP_MAC_CSC_LINK
gh secret set APPLE_API_KEY_P8 < AuthKey_XXXXXXXXXX.p8
```

## Cut a release

1. Bump `version` in `apps/desktop/package.json` on `main`.
2. Tag that commit `v<version>` and push the tag:

```sh
git tag v0.1.1
git push origin v0.1.1
```

The workflow refuses tags that do not match the desktop version, are not on
`main`, or are not newer than the latest published release.

## Releases happen on their own

Bump `version` in `apps/desktop/package.json` in a pull request. The website needs no change: it links to
the latest release. When it is merged and the `checks` on `main` pass, the
`release-on-version-bump` workflow tags that commit `v<version>` and starts the `desktop-apps` build,
which publishes the release. Nothing needs running by hand. A version whose tag already exists is
left alone, so pushing the tag yourself is still fine.

## The first releases

Until there are signing certificates, push a `vX.Y.Z` tag that matches `version` in
`apps/desktop/package.json` and the `desktop-apps` workflow builds macOS (one universal app for Apple silicon and Intel), Windows and
Linux, then publishes them as the latest release with the install scripts and checksums. The builds
are unsigned, so macOS and Windows warn the first time the app opens. `release-desktop` is the
signed, notarized path for when the certificates exist.

## Install in one line

Each release also carries `install.sh` (macOS and Linux) and `install.ps1` (Windows),
and the installers have stable names (`corvo-mac-universal.zip`,
`corvo-linux-x86_64.AppImage`, `corvo-linux-arm64.AppImage`, `corvo-win-x64.exe`) so the scripts never need a version:

```sh
curl -fsSL https://github.com/corvo-technology/rook/releases/latest/download/install.sh | sh
```

```powershell
irm https://github.com/corvo-technology/rook/releases/latest/download/install.ps1 | iex
```

These links only work while the release assets are publicly downloadable, and so does the
app's auto-update. For a private repository, publish releases to a public one instead and
change `publish` in `apps/desktop/package.json` and the base URL in both scripts.
To try a script before a release, set `CORVO_BASE_URL` (a folder or URL with the files) and
`CORVO_DEST` (a throwaway folder).
