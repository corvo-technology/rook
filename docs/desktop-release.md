# Desktop releases

The `release-desktop` workflow builds, signs, notarizes, attests, and publishes
the Electron app from a `vMAJOR.MINOR.PATCH` tag on `main`. Publishing the
Docker images triggers from the same tag.

Releases are served from a public, releases-only repository,
`corvo-technology/rook-releases`, so this repository can be private. The tag stays here, where the
code lives. Installed apps update from `rook-releases` (`publish` in `apps/desktop/package.json`),
and the install scripts download from it. `scripts/publish-release.sh` creates the release in each
repository, and a release that already exists there is skipped, so a failed run can be rerun.

| Secret | Value |
| --- | --- |
| `RELEASES_REPO_TOKEN` | Fine-grained token (or GitHub App token) with `contents: write` on `rook-releases` only |

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
`corvo-linux-x86_64.AppImage`, `corvo-linux-arm64.AppImage`, `corvo-win-x64.exe`) so the scripts never need a version.
The website serves the scripts from `apps/desktop/install/`:

```sh
curl -fsSL https://rook.team/install | sh
```

```powershell
irm https://rook.team/install.ps1 | iex
```

The scripts download from `https://github.com/corvo-technology/rook-releases/releases/latest/download`.
To try a script before a release, set `CORVO_BASE_URL` (a folder or URL with the files) and
`CORVO_DEST` (a throwaway folder).

## Closing the source repository

Apps installed before this change still update from this repository, so it stays public until
they have moved. `PUBLISH_TO_SOURCE_REPO` in `desktop-apps.yml` and `release-desktop.yml` makes
every release also appear here.

1. Create `corvo-technology/rook-releases`: public, with a README and no code.
2. Add the `RELEASES_REPO_TOKEN` secret to this repository.
3. Ship one release with dual publishing on (the default). Installed apps receive it from here and
   from then on look at `rook-releases`.
4. Wait at least one more release cycle for users to update.
5. Make this repository private and set `PUBLISH_TO_SOURCE_REPO` to `"false"` (or delete that
   step) in both workflows.

Apps that skip the transition release stop updating and must reinstall with the command above.
