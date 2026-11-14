#!/usr/bin/env bash
# Publishes a desktop release to one GitHub repository: a draft with every file, then published as
# the latest release, so nobody sees a half-uploaded release. A release that already exists is left
# alone, which makes a rerun after a partial failure safe.
#
#   GH_TOKEN=... publish-release.sh <owner/repo> <tag> <title> <file>...
#
# Environment: VERIFY_TAG=1 requires the tag to exist in the repository (the source repository);
# NOTES is the release body; GENERATE_NOTES=1 adds generated notes (only useful where the code is).
set -euo pipefail

repo="${1:?repository}"
tag="${2:?tag}"
title="${3:?title}"
shift 3

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "No token to publish to $repo." >&2
  exit 1
fi
if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  echo "$repo already has a release for $tag: leaving it as it is."
  exit 0
fi

args=(--repo "$repo" --draft --title "$title" --notes "${NOTES:-}")
[[ "${VERIFY_TAG:-}" == "1" ]] && args+=(--verify-tag)
[[ "${GENERATE_NOTES:-}" == "1" ]] && args+=(--generate-notes)

cleanup() {
  # Remove an incomplete draft; a published release is never touched.
  if [[ "$(gh release view "$tag" --repo "$repo" --json isDraft --jq .isDraft 2>/dev/null)" == "true" ]]; then
    gh release delete "$tag" --repo "$repo" --yes || true
  fi
}
trap cleanup ERR

gh release create "$tag" "$@" "${args[@]}"
gh release edit "$tag" --repo "$repo" --draft=false --latest
echo "Published $tag to $repo."
