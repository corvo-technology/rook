import type * as Jsdom from "jsdom";

let loading: Promise<typeof Jsdom> | undefined;

/**
 * jsdom is the largest dependency the servers carry (several hundred modules), and only a
 * few tools parse HTML with it, so it loads on first use instead of at boot.
 */
export function loadJsdom(): Promise<typeof Jsdom> {
  loading ??= import("jsdom");
  return loading;
}
