import { BOT_AVATAR_CHARACTER_IDS } from "@corvo/contracts";
import { BotAvatar } from "@corvo/ui-web";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { AvatarStudioPopover } from "../../src/pages/shell/avatar-studio-popover";

// The characters an agent can wear, in the agent's color and at the sizes the app draws, so the
// look can be checked without a backend. State lives in the URL (?theme=light|dark&color=%23hex).

const params = new URLSearchParams(location.search);
const color = params.get("color") ?? "#8B5CF6";
const status = params.get("status") ?? undefined;

function Page() {
  const [value, setValue] = useState(color);
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mb-8 flex items-center gap-4" data-testid="studio-host">
        <AvatarStudioPopover value={value} identity="studio" size={72} onChange={setValue} />
        <span className="text-xs tabular-nums text-muted-foreground" data-testid="studio-value">
          {value}
        </span>
      </div>
      <div className="grid grid-cols-6 gap-x-4 gap-y-5" data-testid="characters">
        {BOT_AVATAR_CHARACTER_IDS.map((id) => (
          <div
            key={id}
            className="flex flex-col items-center gap-2"
            data-testid={`character-${id}`}
          >
            <BotAvatar color={`${color}::char_${id}`} size={92} identity={id} status={status} />
            <div className="flex items-center gap-2">
              <BotAvatar color={`${color}::char_${id}`} size={38} identity={id} status={status} />
              <BotAvatar color={`${color}::char_${id}`} size={24} identity={id} status={status} />
            </div>
            <span className="text-[11px] text-muted-foreground">{id}</span>
          </div>
        ))}
      </div>
    </main>
  );
}

const theme = params.get("theme") === "light" ? "light" : "dark";
applyResolvedAppearance(theme);
await bootstrapI18n("en");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <BrowserRouter>
      <Page />
    </BrowserRouter>
  </I18nProvider>,
);
