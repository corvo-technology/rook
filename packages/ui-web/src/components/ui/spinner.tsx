import { cn } from "@corvo/ui-web/lib/utils";
import { Loader2Icon } from "lucide-react";
import * as React from "react";

/** The accessible name of every spinner; the kit itself is not translated. */
const SpinnerLabelContext = React.createContext("Loading");

/** Supplies the translated accessible name for every spinner below it. */
function SpinnerLabelProvider({ label, children }: { label: string; children: React.ReactNode }) {
  return <SpinnerLabelContext.Provider value={label}>{children}</SpinnerLabelContext.Provider>;
}

/** The translated accessible name every wait carries, for loaders that are not the spinner. */
function useSpinnerLabel() {
  return React.useContext(SpinnerLabelContext);
}

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const label = React.useContext(SpinnerLabelContext);
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={label}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner, SpinnerLabelProvider, useSpinnerLabel };
