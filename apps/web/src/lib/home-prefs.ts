export type StartPage = "home" | "chat";
export type HomeCardId = "waiting" | "working" | "routines";

export const HOME_CARD_IDS: readonly HomeCardId[] = ["waiting", "working", "routines"];

/** How the Home cards are arranged: their order and which are hidden. */
export type HomeLayout = { order: HomeCardId[]; hidden: HomeCardId[] };

export const DEFAULT_HOME_LAYOUT: HomeLayout = { order: [...HOME_CARD_IDS], hidden: [] };

const startKey = (userId: string) => `corvo:start-page:${userId}`;
const layoutKey = (userId: string) => `corvo:home-layout:${userId}`;

function read(key: string | null): string | null {
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string | null, value: string | null) {
  if (!key) return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // The choice still applies for this visit.
  }
}

export function readStartPage(userId: string | null | undefined): StartPage {
  return read(userId ? startKey(userId) : null) === "chat" ? "chat" : "home";
}

export function writeStartPage(userId: string | null | undefined, page: StartPage): void {
  write(userId ? startKey(userId) : null, page === "chat" ? "chat" : null);
}

/** Keeps only known cards, once each, and appends any the saved order forgot. */
export function normalizeLayout(value: unknown): HomeLayout {
  const raw = (value ?? {}) as Partial<Record<keyof HomeLayout, unknown>>;
  const known = (list: unknown): HomeCardId[] =>
    Array.isArray(list)
      ? [...new Set(list.filter((id): id is HomeCardId => HOME_CARD_IDS.includes(id)))]
      : [];
  const order = known(raw.order);
  for (const id of HOME_CARD_IDS) if (!order.includes(id)) order.push(id);
  return { order, hidden: known(raw.hidden) };
}

export function readHomeLayout(userId: string | null | undefined): HomeLayout {
  const stored = read(userId ? layoutKey(userId) : null);
  if (!stored) return DEFAULT_HOME_LAYOUT;
  try {
    return normalizeLayout(JSON.parse(stored));
  } catch {
    return DEFAULT_HOME_LAYOUT;
  }
}

export function writeHomeLayout(userId: string | null | undefined, layout: HomeLayout): void {
  write(userId ? layoutKey(userId) : null, JSON.stringify(layout));
}

/** Moves a card one place earlier (-1) or later (1) among the shown ones. */
export function moveCard(layout: HomeLayout, id: HomeCardId, by: -1 | 1): HomeLayout {
  const shown = layout.order.filter((card) => !layout.hidden.includes(card));
  const from = shown.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= shown.length) return layout;
  const swapWith = shown[to] as HomeCardId;
  const order = [...layout.order];
  const a = order.indexOf(id);
  const b = order.indexOf(swapWith);
  order[a] = swapWith;
  order[b] = id;
  return { ...layout, order };
}

export function setCardHidden(layout: HomeLayout, id: HomeCardId, hidden: boolean): HomeLayout {
  const rest = layout.hidden.filter((card) => card !== id);
  return { ...layout, hidden: hidden ? [...rest, id] : rest };
}
