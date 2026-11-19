import type { PartnerBranding, PartnerConsolePartner } from "@corvo/contracts";
import { BRAND_ASSET_MAX_BYTES, checkAccent } from "@corvo/contracts";
import { webLightTokens } from "@corvo/ui-tokens";
import { Button, Input, Label } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { brandingErrorText } from "../../lib/branding-errors";
import { accentTokens } from "../../lib/embed";
import { rpc } from "../../lib/rpc";
import { Panel, PartnerError, PartnerLoading, useAction } from "./partner-ui";

export const brandingKey = (partnerId: string) => ["partner-console", partnerId, "branding"];

/** The saved brand, shared by the brand and domain screens. */
export function useBranding(partner: PartnerConsolePartner) {
  return useQuery({
    queryKey: brandingKey(partner.id),
    queryFn: () => rpc.partnerConsole.branding({ partnerId: partner.id }),
  });
}

type Pick = {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataBase64: string;
  url: string;
};

/** What changed about an image: nothing, a new file, or its removal. */
type ImageDraft = { kind: "keep" } | { kind: "remove" } | { kind: "new"; pick: Pick };

async function readImage(file: File): Promise<Pick | null> {
  const types = ["image/png", "image/jpeg", "image/webp"] as const;
  const mimeType = types.find((type) => type === file.type);
  if (!mimeType || file.size > BRAND_ASSET_MAX_BYTES) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { mimeType, dataBase64: btoa(binary), url: URL.createObjectURL(file) };
}

export function PartnerBrand({ partner }: { partner: PartnerConsolePartner }) {
  const branding = useBranding(partner);
  if (branding.isPending) return <PartnerLoading />;
  if (branding.isError) return <PartnerError error={branding.error} onRetry={branding.refetch} />;
  // The form restarts from the saved brand whenever it changes.
  return (
    <BrandForm key={JSON.stringify(branding.data.brand)} partner={partner} data={branding.data} />
  );
}

function BrandForm({ partner, data }: { partner: PartnerConsolePartner; data: PartnerBranding }) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const action = useAction();
  const saved = data.brand;
  const [appName, setAppName] = useState(saved?.appName ?? partner.name);
  const [accent, setAccent] = useState(saved?.accent ?? "");
  const [supportEmail, setSupportEmail] = useState(saved?.supportEmail ?? "");
  const [termsUrl, setTermsUrl] = useState(saved?.termsUrl ?? "");
  const [privacyUrl, setPrivacyUrl] = useState(saved?.privacyUrl ?? "");
  const [logo, setLogo] = useState<ImageDraft>({ kind: "keep" });
  const [icon, setIcon] = useState<ImageDraft>({ kind: "keep" });
  const [imageError, setImageError] = useState<string | null>(null);

  const check = accent.trim() === "" ? null : checkAccent(accent);
  const accentInvalid = accent.trim() !== "" && !check?.ok;
  const valid = appName.trim() !== "" && !accentInvalid;
  const dirty =
    appName.trim() !== (saved?.appName ?? "") ||
    accent.trim().toLowerCase() !== (saved?.accent ?? "") ||
    supportEmail.trim() !== (saved?.supportEmail ?? "") ||
    termsUrl.trim() !== (saved?.termsUrl ?? "") ||
    privacyUrl.trim() !== (saved?.privacyUrl ?? "") ||
    logo.kind !== "keep" ||
    icon.kind !== "keep";

  const shown = (draft: ImageDraft, savedUrl: string | null | undefined) =>
    draft.kind === "new" ? draft.pick.url : draft.kind === "remove" ? null : (savedUrl ?? null);
  const logoUrl = shown(logo, saved?.logoUrl);
  const iconUrl = shown(icon, saved?.iconUrl);
  const draftPayload = (draft: ImageDraft) =>
    draft.kind === "new"
      ? { mimeType: draft.pick.mimeType, dataBase64: draft.pick.dataBase64 }
      : draft.kind === "remove"
        ? null
        : undefined;
  const accentStyle = check?.ok ? accentTokens(check.hex) : undefined;

  async function choose(file: File | undefined, set: (draft: ImageDraft) => void) {
    if (!file) return;
    const pick = await readImage(file);
    if (!pick) {
      setImageError(t`Use a PNG, JPEG or WebP image up to 256 KB.`);
      return;
    }
    setImageError(null);
    set({ kind: "new", pick });
  }

  return (
    <form
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
      data-testid="partner-brand"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !dirty) return;
        void action.run(async () => {
          const next = await rpc.partnerConsole.setBrand({
            partnerId: partner.id,
            appName: appName.trim(),
            accent: check?.ok ? check.hex : null,
            supportEmail: supportEmail.trim() === "" ? null : supportEmail.trim(),
            termsUrl: termsUrl.trim() === "" ? null : termsUrl.trim(),
            privacyUrl: privacyUrl.trim() === "" ? null : privacyUrl.trim(),
            logo: draftPayload(logo),
            icon: draftPayload(icon),
          });
          queryClient.setQueryData(brandingKey(partner.id), next);
        });
      }}
    >
      <div className="space-y-4">
        <Panel>
          <div className="space-y-3">
            <div>
              <Label htmlFor="brand-name">{t`Name`}</Label>
              <Input
                id="brand-name"
                value={appName}
                maxLength={40}
                onChange={(event) => setAppName(event.target.value)}
                className="mt-1.5"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ImagePicker
                label={t`Logo`}
                url={logoUrl}
                onPick={(file) => void choose(file, setLogo)}
                onRemove={() => setLogo({ kind: "remove" })}
              />
              <ImagePicker
                label={t`Icon`}
                url={iconUrl}
                onPick={(file) => void choose(file, setIcon)}
                onRemove={() => setIcon({ kind: "remove" })}
              />
            </div>
            {imageError ? (
              <p role="alert" className="text-sm text-destructive">
                {imageError}
              </p>
            ) : null}
            <div>
              <Label htmlFor="brand-accent">{t`Brand colour`}</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  aria-label={t`Brand colour`}
                  value={check?.hex ?? webLightTokens.foreground.toLowerCase()}
                  onChange={(event) => setAccent(event.target.value)}
                  className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
                />
                <Input
                  id="brand-accent"
                  value={accent}
                  placeholder="#rrggbb"
                  onChange={(event) => setAccent(event.target.value)}
                  aria-invalid={accentInvalid || undefined}
                  className="w-32"
                />
              </div>
              {accentInvalid ? (
                <p role="alert" className="mt-1.5 text-sm text-destructive">
                  {t`Not enough contrast on both light and dark.`}
                </p>
              ) : null}
            </div>
          </div>
        </Panel>
        <Panel>
          <div className="space-y-3">
            <div>
              <Label htmlFor="brand-support">{t`Support email`}</Label>
              <Input
                id="brand-support"
                type="email"
                value={supportEmail}
                onChange={(event) => setSupportEmail(event.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="brand-terms">{t`Terms URL`}</Label>
              <Input
                id="brand-terms"
                value={termsUrl}
                placeholder="https://"
                inputMode="url"
                onChange={(event) => setTermsUrl(event.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="brand-privacy">{t`Privacy URL`}</Label>
              <Input
                id="brand-privacy"
                value={privacyUrl}
                placeholder="https://"
                inputMode="url"
                onChange={(event) => setPrivacyUrl(event.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
        </Panel>
        {action.error ? (
          <PartnerError error={action.error} message={brandingErrorText(action.error)} />
        ) : null}
        <Button type="submit" disabled={action.busy || !valid || !dirty}>
          {t`Save`}
        </Button>
      </div>
      <div
        role="img"
        aria-label={t`Preview`}
        data-testid="brand-preview"
        style={accentStyle}
        className="h-fit rounded-xl border border-border bg-card p-6"
      >
        <div className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="size-7 rounded-md object-contain" />
          ) : null}
          {appName.trim() || partner.name}
        </div>
        <div className="mt-8 space-y-2.5">
          <div className="h-10 rounded-xl border border-input" />
          <div className="h-10 rounded-xl bg-primary" />
        </div>
        {termsUrl.trim() || privacyUrl.trim() ? (
          <div className="mt-6 flex gap-3 text-xs text-muted-foreground">
            {termsUrl.trim() ? <span>{t`Terms`}</span> : null}
            {privacyUrl.trim() ? <span>{t`Privacy`}</span> : null}
          </div>
        ) : null}
      </div>
    </form>
  );
}

function ImagePicker({
  label,
  url,
  onPick,
  onRemove,
}: {
  label: string;
  url: string | null;
  onPick: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  const { t } = useLingui();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-background">
          {url ? <img src={url} alt="" className="size-full object-contain" /> : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={label}
          className="sr-only"
          onChange={(event) => {
            onPick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
          {url ? t`Replace` : t`Upload`}
        </Button>
        {url ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t`Remove`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
