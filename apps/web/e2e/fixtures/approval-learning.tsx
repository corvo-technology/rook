import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { buildApprovalAskBlock } from "../../../../packages/adapters/src/approval-ask";
import { AskCard } from "../../src/components/AskCard";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import "../../src/styles.css";

const block = buildApprovalAskBlock("fixture-effect", "crm_update_contact", { title: "Note" }, [], {
  alwaysAllow: { agent: "Ana", connection: "crm", tool: "crm_update_contact" },
  suggestAlways: new URLSearchParams(location.search).get("learned") === "1",
});

if (block.kind !== "ask") throw new Error("Expected approval card");
void bootstrapI18n("en").then(() => {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <main className="mx-auto max-w-xl p-6">
        <AskCard
          block={block}
          canAnswer
          canDismiss={false}
          onAnswer={async () => undefined}
          onDismiss={async () => undefined}
        />
      </main>
    </I18nProvider>,
  );
});
