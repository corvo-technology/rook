import { useLingui } from "@lingui/react/macro";

/** A dot, not a word: the part is new until the person first opens it. */
export function NewDot({ className = "absolute end-3 top-2" }: { className?: string }) {
  const { t } = useLingui();
  return (
    <>
      <span aria-hidden className={`${className} size-2 rounded-full bg-primary`} />
      <span className="sr-only">{t`New`}</span>
    </>
  );
}
