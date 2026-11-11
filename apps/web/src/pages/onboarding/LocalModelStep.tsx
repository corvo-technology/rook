import { type ComponentProps, useState } from "react";
import { useLocalSetup } from "../../lib/local-setup";
import { QuickKeyConnect } from "../onboarding-quick-connect";
import { LocalModelChoice } from "./LocalModelChoice";

/**
 * The model step's body. When the engine found models on its own computer or account, they are
 * offered first. Where nothing is found, or detection is off, it is the key step as before. Once
 * the person has opened the key step or started typing a key, a later report never replaces it.
 */
export function LocalModelStep(props: ComponentProps<typeof QuickKeyConnect>) {
  const { report } = useLocalSetup();
  const [touched, setTouched] = useState(false);
  if (report?.enabled && report.options.length > 0 && !touched) {
    return (
      <LocalModelChoice
        report={report}
        onContinue={props.onConnected}
        onFallback={() => setTouched(true)}
      />
    );
  }
  return (
    <QuickKeyConnect
      {...props}
      onEdit={() => {
        setTouched(true);
        props.onEdit?.();
      }}
    />
  );
}
