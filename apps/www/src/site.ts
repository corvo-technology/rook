export const SITE_NAME = "Rook";
export const SITE_URL = "https://rook.team";
/** Bump when the social images change: X, LinkedIn, WhatsApp and Slack keep the old one cached by URL. */
export const SOCIAL_IMAGE_VERSION = "2";
export const SITE_DESCRIPTION =
  "Rook is a team of AI agents for companies. It lives in channels, remembers what matters and asks before it touches anything real.";

export const CONTACT_EMAIL = "legal@rook.team";
export const SECURITY_EMAIL = "security@rook.team";

/** Where the app files are published: a releases-only repository. */
export const RELEASES_URL = "https://github.com/corvo-technology/rook-releases/releases/latest/download";

/** Where the cloud API lives. The waitlist form posts here; set PUBLIC_API_ORIGIN to point a build elsewhere. */
export const API_ORIGIN =
  (import.meta.env?.PUBLIC_API_ORIGIN as string | undefined)?.trim().replace(/\/$/, "") || "https://api.rook.team";
export const WAITLIST_ENDPOINT = `${API_ORIGIN}/api/public/waitlist`;
export const PARTNER_LEADS_ENDPOINT = `${API_ORIGIN}/api/public/partner-leads`;

/** The documentation site. */
export const DOCS_URL = "https://docs.rook.team";

/** The technical docs for partners. */
export const PARTNER_DOCS_URL = "https://docs.rook.team/parceiros";

/**
 * The macOS installer (one universal app for Apple silicon and Intel) of the latest release. Its file name carries no version, so
 * a new release needs no change here and the link never points at a release that is not out yet.
 */
export const DOWNLOAD_URL = `${RELEASES_URL}/corvo-mac-universal.dmg`;

/** Direct installers with stable names, so the links never need a version. */
export const DOWNLOAD_URL_WINDOWS = `${RELEASES_URL}/corvo-win-x64.exe`;
export const DOWNLOAD_URL_LINUX = `${RELEASES_URL}/corvo-linux-x86_64.AppImage`;
export const DOWNLOAD_URL_LINUX_DEB = `${RELEASES_URL}/corvo-linux-amd64.deb`;
export const DOWNLOAD_URL_LINUX_ARM64 = `${RELEASES_URL}/corvo-linux-arm64.AppImage`;
export const DOWNLOAD_URL_LINUX_ARM64_DEB = `${RELEASES_URL}/corvo-linux-arm64.deb`;

/** The one-line installs. The site serves both scripts itself (see the install endpoints). */
export const INSTALL_COMMAND = `curl -fsSL ${SITE_URL}/install | sh`;
export const INSTALL_COMMAND_WINDOWS = `irm ${SITE_URL}/install.ps1 | iex`;
