import type { RouterClient } from "@orpc/server";
import type { createRouter } from "../router.js";

type Client = RouterClient<ReturnType<typeof createRouter>>;

/**
 * The only procedures the MCP tools may call. They are the app's own, so each runs with the same
 * authorization and row-level security as a request from the app; a procedure that deletes,
 * decides an approval, manages people or secrets, or loosens a rule is not listed, so no tool can
 * reach it.
 */
export interface McpAppClient {
  spaces: Pick<Client["spaces"], "list">;
  bots: Pick<Client["bots"], "list" | "create" | "update">;
  groups: Pick<Client["groups"], "list">;
  threads: Pick<Client["threads"], "get" | "send">;
  tickets: Pick<Client["tickets"], "list" | "get" | "create" | "comment" | "comments">;
  routines: Pick<Client["routines"], "create" | "update">;
  wiki: Pick<Client["wiki"], "write">;
}
