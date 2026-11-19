import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("routines started by a partner's events read as the moment they wait for", async ({
  page,
}, testInfo) => {
  await signup(page, `routines-events-${Date.now()}@corvo.test`, "password12", "Events QA");
  await completeOnboarding(page, testInfo);
  await page.route("**/rpc/routines/events", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            id: "r1",
            botId: "unknown-bot",
            name: "Reschedule no-shows",
            active: true,
            on: { type: "appointment.no_show" },
            lastTriggeredAt: new Date().toISOString(),
          },
          {
            id: "r2",
            botId: "unknown-bot",
            name: "Win back quiet customers",
            active: false,
            on: { type: "customer.inactive" },
            lastTriggeredAt: null,
          },
        ],
      },
    }),
  );
  await page.goto("/app/routines");

  const list = page.getByTestId("event-routines");
  await expect(list).toContainText("When a customer doesn't show up…");
  await expect(list).toContainText("When a customer stops coming…");
  await expect(page.getByRole("switch", { name: "Reschedule no-shows" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Win back quiet customers" })).not.toBeChecked();
  await captureScreenshot(page, testInfo, "routines-events");
});
