import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
} from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { countryCode, currencyOf, PARTNER_SLUG, slugFromName } from "../../lib/platform-onboarding";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";

type Mode = "embedded" | "white_label" | "referral";

/** The application being approved; without one the operator also types who owns the partner. */
export interface PartnerLeadDraft {
  id: string;
  company: string;
  email: string;
  country: string | null;
}

/** Makes a partner: from an application when there is one, or from scratch. */
export function NewPartnerDialog({
  lead,
  onClose,
}: {
  lead?: PartnerLeadDraft;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const client = useQueryClient();
  const pricing = useQuery(queries.platform.partnerPricing.get.queryOptions());
  const tiers = pricing.data?.config.tiers ?? [];
  const [name, setName] = useState(lead?.company ?? "");
  const [slug, setSlug] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("embedded");
  const [country, setCountry] = useState(countryCode(lead?.country));
  const [plan, setPlan] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const done = async () => {
    await client.invalidateQueries({ queryKey: queries.platform.partners.key() });
    await client.invalidateQueries({ queryKey: queries.platform.partnerLeads.key() });
    onClose();
  };
  const create = useMutation({
    ...queries.platform.partners.create.mutationOptions(),
    onSuccess: done,
  });
  const approve = useMutation({
    ...queries.platform.partnerLeads.approve.mutationOptions(),
    onSuccess: done,
  });
  const chosenSlug = slug ?? slugFromName(name);
  const planKey = mode === "embedded" ? plan || tiers[0]?.key || null : null;
  const valid =
    name.trim() !== "" &&
    PARTNER_SLUG.test(chosenSlug) &&
    /^[A-Za-z]{2}$/.test(country) &&
    (lead !== undefined || /^\S+@\S+\.\S+$/.test(ownerEmail.trim()));
  const pending = create.isPending || approve.isPending;
  const error = create.error ?? approve.error;
  const modes: Array<[Mode, string]> = [
    ["embedded", t`Embedded`],
    ["white_label", t`White label`],
    ["referral", t`Referral`],
  ];

  function submit() {
    const partner = {
      name: name.trim(),
      slug: chosenSlug,
      mode,
      country: country.toUpperCase(),
      planKey,
    };
    if (lead) approve.mutate({ id: lead.id, partner });
    else create.mutate({ ...partner, ownerEmail: ownerEmail.trim() });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lead ? t`Approve partner` : t`New partner`}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !pending) submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t`Product name`}</span>
            <Input
              aria-label={t`Product name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t`Slug`}</span>
            <Input
              aria-label={t`Slug`}
              value={chosenSlug}
              aria-invalid={chosenSlug !== "" && !PARTNER_SLUG.test(chosenSlug)}
              onChange={(event) => setSlug(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t`Mode`}</span>
              <NativeSelect
                className="w-full"
                aria-label={t`Mode`}
                value={mode}
                onChange={(event) => setMode(event.target.value as Mode)}
              >
                {modes.map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">
                {t`Country`}
                {/^[A-Za-z]{2}$/.test(country) ? ` · ${currencyOf(country)}` : ""}
              </span>
              <Input
                aria-label={t`Country`}
                maxLength={2}
                placeholder="BR"
                value={country}
                onChange={(event) => setCountry(event.target.value.toUpperCase())}
              />
            </div>
          </div>
          {mode === "embedded" ? (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t`Plan`}</span>
              <NativeSelect
                className="w-full"
                aria-label={t`Plan`}
                value={planKey ?? ""}
                onChange={(event) => setPlan(event.target.value)}
              >
                {tiers.map((tier) => (
                  <NativeSelectOption key={tier.key} value={tier.key}>
                    {tier.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          {lead ? (
            <p className="text-muted-foreground">{lead.email}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t`Owner email`}</span>
              <Input
                type="email"
                aria-label={t`Owner email`}
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
              />
            </div>
          )}
          {error ? (
            <p role="alert" className="text-destructive">
              {errorText(error, t`Could not save`)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t`Cancel`}
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {lead ? t`Approve` : t`Create`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
