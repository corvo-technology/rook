import type { PlanOverride } from "@corvo/contracts";
import { COMPUTER_SIZES } from "@corvo/contracts";
import { Button, Input, NativeSelect, NativeSelectOption } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { NumberInput } from "./fields";

interface LimitsForm {
  computerSize: string;
  computers: string;
  storageGb: string;
  maxSeats: string;
}

const formOf = (override: PlanOverride | undefined): LimitsForm => ({
  computerSize: override?.computerSize ?? "",
  computers: override?.computers?.toString() ?? "",
  storageGb: override?.storageGb?.toString() ?? "",
  maxSeats: override?.maxSeats?.toString() ?? "",
});

/** What is typed as an override; blank fields stay unset, so the plan's value applies. */
export function overrideOf(form: LimitsForm): PlanOverride | null {
  const out: PlanOverride = {};
  if (form.computerSize) out.computerSize = form.computerSize as PlanOverride["computerSize"];
  for (const key of ["computers", "maxSeats"] as const) {
    if (form[key].trim() === "") continue;
    const value = Number(form[key]);
    if (!Number.isInteger(value) || value < 1) return null;
    out[key] = value;
  }
  if (form.storageGb.trim() !== "") {
    const value = Number(form.storageGb.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return null;
    out.storageGb = value;
  }
  return out;
}

export function LimitsSection() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const client = useQueryClient();
  const [typed, setTyped] = useState("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [form, setForm] = useState<LimitsForm>(formOf(undefined));
  const [saved, setSaved] = useState(false);
  const limits = useQuery({
    ...queries.platform.limits.get.queryOptions({
      input: { organizationId: organizationId ?? "" },
    }),
    enabled: organizationId !== null,
  });
  useEffect(() => {
    if (limits.data) setForm(formOf(limits.data.override));
  }, [limits.data]);
  const save = useMutation({
    ...queries.platform.limits.set.mutationOptions(),
    onSuccess: async () => {
      setSaved(true);
      await client.invalidateQueries({ queryKey: queries.platform.limits.get.key() });
    },
  });
  const override = overrideOf(form);
  const plan = limits.data?.plan;
  const set = (key: keyof LimitsForm, value: string) => {
    setSaved(false);
    setForm({ ...form, [key]: value });
  };

  return (
    <div className="flex max-w-xl flex-col gap-6" data-testid="platform-limits">
      <h1 className="text-2xl font-light tracking-tight">{t`Limits by organization`}</h1>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed.trim()) setOrganizationId(typed.trim());
        }}
      >
        <Input
          aria-label={t`Organization ID`}
          placeholder={t`Organization ID`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!typed.trim()}>
          {t`Open`}
        </Button>
      </form>

      {limits.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(limits.error, t`Could not load`)}
        </p>
      ) : null}

      {limits.data ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{plan ? t`Plan: ${plan}` : t`No plan`}</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t`Computer size`}</span>
              <NativeSelect
                className="w-full"
                aria-label={t`Computer size`}
                value={form.computerSize}
                onChange={(event) => set("computerSize", event.target.value)}
              >
                <NativeSelectOption value="">{t`Plan default`}</NativeSelectOption>
                {COMPUTER_SIZES.map((size) => (
                  <NativeSelectOption key={size} value={size}>
                    {size}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t`Computers`}</span>
              <NumberInput
                label={t`Computers`}
                className="w-full"
                placeholder={t`Plan default`}
                value={form.computers}
                onChange={(event) => set("computers", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t`Storage (GB)`}</span>
              <NumberInput
                label={t`Storage (GB)`}
                className="w-full"
                placeholder={t`Plan default`}
                value={form.storageGb}
                onChange={(event) => set("storageGb", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t`Seats`}</span>
              <NumberInput
                label={t`Seats`}
                className="w-full"
                placeholder={t`Plan default`}
                value={form.maxSeats}
                onChange={(event) => set("maxSeats", event.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              disabled={!override || !organizationId || save.isPending}
              onClick={() =>
                override && organizationId && save.mutate({ organizationId, override })
              }
            >
              {t`Save`}
            </Button>
            {saved ? <span className="text-sm text-muted-foreground">{t`Saved`}</span> : null}
            {save.error ? (
              <span role="alert" className="text-sm text-destructive">
                {errorText(save.error, t`Could not save`)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
