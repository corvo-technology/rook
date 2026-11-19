import { t } from "@lingui/core/macro";
import { errorText } from "./user-error";

/** What the white label console says when the server refuses, by the reason it names. */
export function brandingErrorText(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (/(too_large|not_an_image)$/.test(message)) {
    return t`Use a PNG, JPEG or WebP image up to 256 KB.`;
  }
  switch (message) {
    case "icon_size":
    case "icon_type":
      return t`The icon must be a square PNG of at least 512 px.`;
    case "hostname":
      return t`Enter a domain such as app.example.com.`;
    case "hostname_taken":
      return t`This domain is already in use.`;
    case "one_domain":
      return t`Remove the current domain first.`;
    case "domain_provider_error":
    case "sender_provider_error":
      return t`The provider did not answer. Try again.`;
    case "brand_required":
      return t`Save the brand first.`;
    default:
      return errorText(error);
  }
}
