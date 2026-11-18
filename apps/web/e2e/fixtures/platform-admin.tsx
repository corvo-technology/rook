import { I18nProvider } from "@lingui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { queryClient, spaceSeedKey } from "../../src/lib/query";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import { PlatformPage } from "../../src/pages/platform/PlatformPage";
import "../../src/styles.css";

// The platform operators' area as an operator sees it. The calls to /rpc/platform are answered by
// the spec, so the screens can be checked without a backend.
// State lives in the URL: ?section=pricing|simulator|partners|invoices|limits&theme=light|dark

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const section = params.get("section") ?? "pricing";

// What the shell has already loaded: this person is an operator.
queryClient.setQueryData(spaceSeedKey(null, null), { me: { partnerAdmin: true } } as never);

applyResolvedAppearance(theme);
await bootstrapI18n("pt-BR");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/app/platform/${section}`]}>
        <div className="flex bg-background text-foreground" style={{ height: "100vh" }}>
          <Routes>
            <Route path="/app/platform/:section?" element={<PlatformPage />} />
          </Routes>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  </I18nProvider>,
);
