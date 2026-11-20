// @vitest-environment jsdom
import type { Bot } from "@corvo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { messageModels } from "../../lib/message-model";
import { ComposerModelChoice } from "./composer-model-choice";

const data = vi.hoisted(() => ({
  credentials: [] as unknown[],
  catalog: [] as unknown[],
  billing: null as unknown,
}));
const picker = vi.hoisted(() => vi.fn());

vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    models: {
      credentials: {
        queryOptions: () => ({ queryKey: ["credentials"], queryFn: async () => data.credentials }),
      },
      list: { queryOptions: () => ({ queryKey: ["catalog"], queryFn: async () => data.catalog }) },
    },
    me: {
      queryOptions: () => ({
        queryKey: ["me"],
        queryFn: async () => ({ defaultProvider: "openai", defaultModel: "gpt-x", partner: null }),
      }),
    },
  }),
}));
vi.mock("../../components/SubscriptionGate", () => ({
  useBilling: () => ({ status: data.billing }),
}));
vi.mock("./chat-model-picker", () => ({
  ChatModelPicker: (props: unknown) => {
    picker(props);
    return null;
  },
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));

const bot = { id: "bot-1", modelProvider: "openai", modelId: "gpt-x" } as Bot;

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ComposerModelChoice bot={bot} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  return { unmount: () => act(async () => root.unmount()) };
}

type PickerProps = {
  choices: { key: string; disabled?: boolean }[];
  value: string;
  onChange: (key: string) => void;
};
const lastProps = () => picker.mock.lastCall?.[0] as PickerProps;

beforeEach(() => {
  picker.mockReset();
  messageModels.set("bot-1", { model: null, keep: false });
  data.billing = null;
  data.credentials = [{ provider: "openai", modelId: null, enabledModelIds: [] }];
  data.catalog = [
    { provider: "openai", id: "gpt-x", label: "GPT X" },
    { provider: "openai", id: "gpt-y", label: "GPT Y" },
  ];
});

it("is hidden with one model and shown with two", async () => {
  data.catalog = [{ provider: "openai", id: "gpt-x", label: "GPT X" }];
  const one = await mount();
  expect(picker).not.toHaveBeenCalled();
  await one.unmount();
  data.catalog.push({ provider: "openai", id: "gpt-y", label: "GPT Y" });
  const two = await mount();
  expect(picker).toHaveBeenCalled();
  await two.unmount();
});

it("starts on the agent's own model and lists no image-only model", async () => {
  data.catalog.push({ provider: "openai", id: "paint", label: "Paint", protocol: "image" });
  const view = await mount();
  expect(lastProps().value).toBe("openai::gpt-x");
  expect(lastProps().choices.map((choice) => choice.key)).toEqual([
    "openai::gpt-x",
    "openai::gpt-y",
  ]);
  await view.unmount();
});

it("applies a pick to the next message only, then returns to the agent's model", async () => {
  const view = await mount();
  await act(async () => lastProps().onChange("openai::gpt-y"));
  expect(messageModels.get("bot-1").model).toEqual({ provider: "openai", modelId: "gpt-y" });
  expect(lastProps().value).toBe("openai::gpt-y");
  messageModels.settle("bot-1");
  expect(messageModels.get("bot-1").model).toBeNull();
  await view.unmount();
});

it("keeps the pick for the conversation when asked", async () => {
  const view = await mount();
  messageModels.set("bot-1", {
    model: { provider: "openai", modelId: "gpt-y" },
    keep: true,
  });
  messageModels.settle("bot-1");
  expect(messageModels.get("bot-1").model).toEqual({ provider: "openai", modelId: "gpt-y" });
  await view.unmount();
});

it("shows a credit model as unavailable without credits", async () => {
  data.catalog.push({ provider: "hosted", id: "big", label: "Big", managed: true });
  data.billing = { access: true, funding: "credits", balanceUsd: 0 };
  const spent = await mount();
  expect(lastProps().choices.find((choice) => choice.key === "hosted::big")?.disabled).toBe(true);
  await spent.unmount();
  data.billing = { access: true, funding: "credits", balanceUsd: 5 };
  const funded = await mount();
  expect(lastProps().choices.find((choice) => choice.key === "hosted::big")?.disabled).toBeFalsy();
  await funded.unmount();
});
