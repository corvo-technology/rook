export const SITE_NAME = "Rook";
export const SITE_URL = "https://rookup.run";
export const SITE_DESCRIPTION =
  "Rook is an open source team of AI agents that lives in channels on your computer, remembers what matters and asks before it touches anything real.";

export const CONTACT_EMAIL = "legal@rookup.run";
export const SECURITY_EMAIL = "security@rookup.run";

/** The open source repository. */
export const GITHUB_URL = "https://github.com/corvo-technology/rook";

/**
 * The macOS installer (one universal app for Apple silicon and Intel) of the latest release. Its file name carries no version, so
 * a new release needs no change here and the link never points at a release that is not out yet.
 */
export const DOWNLOAD_URL = `${GITHUB_URL}/releases/latest/download/corvo-mac-universal.dmg`;

/** Direct installers with stable names, so the links never need a version. */
export const DOWNLOAD_URL_WINDOWS = `${GITHUB_URL}/releases/latest/download/corvo-win-x64.exe`;
export const DOWNLOAD_URL_LINUX = `${GITHUB_URL}/releases/latest/download/corvo-linux-x86_64.AppImage`;
export const DOWNLOAD_URL_LINUX_DEB = `${GITHUB_URL}/releases/latest/download/corvo-linux-amd64.deb`;
export const DOWNLOAD_URL_LINUX_ARM64 = `${GITHUB_URL}/releases/latest/download/corvo-linux-arm64.AppImage`;
export const DOWNLOAD_URL_LINUX_ARM64_DEB = `${GITHUB_URL}/releases/latest/download/corvo-linux-arm64.deb`;

/**
 * The one-line installs. They download from the latest release, so they only work once a release
 * with the install scripts and the app files is published as the latest one.
 */
export const INSTALL_COMMAND = `curl -fsSL ${GITHUB_URL}/releases/latest/download/install.sh | sh`;
export const INSTALL_COMMAND_WINDOWS = `irm ${GITHUB_URL}/releases/latest/download/install.ps1 | iex`;
