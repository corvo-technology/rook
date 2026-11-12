import {
  disabledBuiltinToolSet,
  FLEET_READ_TOOL_NAMES,
  FLEET_TOOL_NAMES,
  FLEET_WRITE_TOOL_NAMES,
} from "@corvo/contracts";
import { isBackgroundRunTrigger, isOwnerStartedRun } from "@corvo/core";
import { builtinAgentTools } from "./builtin-tools.js";
import { selectCloudAgentTools } from "./cloud-agent-tools-select.js";
import { selectMemoryTools } from "./memory-tools.js";
import { filterImageReturningComputerTools } from "./model-vision.js";
import { filterBuiltinToolsForRun, filterBuiltinToolsForThread } from "./schedule-tools.js";

export const READ_ONLY_AGENT_TOOLS = new Set([
  "computer_observe",
  "list_files",
  "list_fleet",
  "store_agents",
  "list_routines",
  "guide_read",
  "space_status",
  "read_file",
  "read_history",
  "search_history",
  "wiki_index",
  "wiki_search",
  "wiki_read",
  "read_document",
  "request_takeover",
  "run_subagent",
  "task_catalog",
  "recall_memory",
  "recall_about_user",
  "schedule_list",
  "scratchpad_list",
  "board_tickets",
  "ticket_get",
  "skill_read",
  "store_skills",
  "web_search",
  "web_fetch",
  "browser_snapshot",
  "list_secrets",
  "cloud_agent_status",
]);

/**
 * The only built-in tools a visitor's run may be offered. A tool is off unless it is named here:
 * a tool added later stays off for visitors until someone decides it belongs. Replying and
 * opening a ticket are what an attendant does; everything that reads or changes the owner's
 * world (computer, browser, memory, wiki, files, secrets, fleet, other agents) is not.
 */
export const VISITOR_BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "message_user",
  "ticket_create",
]);

/**
 * The connector tools a visitor's run may use: those of an app the owner ticked for the number.
 * A tool is recognized by its installed app's id, its source label, or the app prefix of a
 * Composio tool name; a tool that none of these ties to a ticked app is dropped.
 */
export function visitorConnectorTools<
  T extends {
    name: string;
    route?: { connectorId?: string; resourceId?: string; catalogGroup?: string } | undefined;
  },
>(tools: readonly T[], ticked: ReadonlySet<string>): T[] {
  if (ticked.size === 0) return [];
  const keys = new Set([...ticked].map((key) => key.toLowerCase()));
  return tools.filter((tool) => {
    const route = tool.route;
    if (route?.resourceId && keys.has(route.resourceId.toLowerCase())) return true;
    if (route?.catalogGroup && keys.has(route.catalogGroup.toLowerCase())) return true;
    if (route?.connectorId === "composio") {
      const app = tool.name.split("_")[0]?.toLowerCase();
      return app !== undefined && keys.has(app);
    }
    return false;
  });
}

export const BUILTIN_AGENT_TOOL_NAMES = new Set(builtinAgentTools.map((tool) => tool.name));

const FLEET_TOOL_NAMES_SET: ReadonlySet<string> = new Set(FLEET_TOOL_NAMES);

export const FLEET_WRITE_TOOL_NAMES_SET: ReadonlySet<string> = new Set(FLEET_WRITE_TOOL_NAMES);

export const FLEET_READ_TOOL_NAMES_SET: ReadonlySet<string> = new Set(FLEET_READ_TOOL_NAMES);

/**
 * The creation intro asks what the bot is for and records the answer on its own profile.
 * It must not act (shell, computer, scheduling, spawning another bot, ...) before the user
 * has said what it is for. Answering its question resumes it as the user's turn, with
 * every tool (see commitAnswerRunInput).
 */
const CREATED_RUN_TOOL_NAMES = new Set(["ask_user", "update_bot"]);

export function selectBuiltinToolsForRun(options: {
  ticketBoardEnabled?: boolean;
  phoneCallsEnabled?: boolean;
  historyRetrievalEnabled?: boolean;
  graphicalToolsAllowed: boolean;
  /** Page browser tools need a graphical computer (Chrome), not model vision. */
  pageBrowserAllowed?: boolean;
  groupId: string | null;
  trigger: string;
  semanticMemoryEnabled: boolean;
  /** The configured provider can forget individual facts. */
  semanticMemoryForgets?: boolean;
  cloudAgentEnabled?: boolean;
  mediaImagesEnabled?: boolean;
  mediaVideoEnabled?: boolean;
  messagingChannelRun: boolean;
  /** Hanging up is only offered to a turn the caller spoke on a live call. */
  voiceCall?: boolean;
  /** Built-in names this bot turned off. Unknown names are ignored. */
  disabledBuiltinTools?: readonly string[];
  /** The bot's fleet management switch. */
  fleetManagement?: boolean;
  /** A follow-up run whose source message the user wrote. */
  followUpFromUser?: boolean;
  /** A routine run with later workflow steps, which may end the chain early. */
  workflowContinues?: boolean;
  /** The channel router woke this run: nobody named the bot, so it may pass. */
  routedRun?: boolean;
  /** An outside person's message on a linked number woke this run: only the visitor allowlist. */
  visitorRun?: boolean;
}) {
  const disabled = disabledBuiltinToolSet(options.disabledBuiltinTools);
  const fleetToolsAllowed = isOwnerStartedRun(options.trigger, Boolean(options.followUpFromUser));
  return selectCloudAgentTools(
    selectMemoryTools(
      filterBuiltinToolsForRun(
        filterBuiltinToolsForThread(
          filterPageBrowserTools(
            filterImageReturningComputerTools(builtinAgentTools, options.graphicalToolsAllowed),
            options.pageBrowserAllowed ?? options.graphicalToolsAllowed,
          ),
          options.groupId,
        ),
        options.trigger,
      ),
      options.semanticMemoryEnabled,
      Boolean(options.semanticMemoryForgets),
    ),
    Boolean(options.cloudAgentEnabled),
  ).filter(
    (tool) =>
      (!options.visitorRun || VISITOR_BUILTIN_TOOL_NAMES.has(tool.name)) &&
      !disabled.has(tool.name) &&
      (options.trigger !== "created" || CREATED_RUN_TOOL_NAMES.has(tool.name)) &&
      (!FLEET_TOOL_NAMES_SET.has(tool.name) ||
        (Boolean(options.fleetManagement) && fleetToolsAllowed)) &&
      (options.workflowContinues || tool.name !== "workflow_stop") &&
      (options.routedRun || tool.name !== "pass") &&
      (options.mediaImagesEnabled || tool.name !== "generate_image") &&
      (options.mediaVideoEnabled || tool.name !== "generate_video") &&
      (options.ticketBoardEnabled ||
        (tool.name !== "board_tickets" && !tool.name.startsWith("ticket_"))) &&
      (!isBackgroundRunTrigger(options.trigger) ||
        ![
          "message_user",
          "message_bot",
          "handoff_to_bot",
          "message_agent",
          "generate_image",
          "generate_video",
        ].includes(tool.name)) &&
      (options.voiceCall || tool.name !== "end_call") &&
      // Already on a call, or reached through a messaging channel that cannot ring.
      ((options.phoneCallsEnabled &&
        !options.groupId &&
        !options.voiceCall &&
        !options.messagingChannelRun &&
        !isBackgroundRunTrigger(options.trigger)) ||
        tool.name !== "call_user") &&
      (options.historyRetrievalEnabled ||
        !["search_history", "read_history"].includes(tool.name)) &&
      (!options.messagingChannelRun ||
        (![
          "remember",
          "remember_about_user",
          "recall_about_user",
          "save_shared_memory",
          "save_memory",
          "recall_memory",
          "forget_memory",
          "wiki_index",
          "wiki_search",
          "wiki_read",
          "read_document",
          "task_catalog",
          "board_tickets",
        ].includes(tool.name) &&
          !tool.name.startsWith("scratchpad_") &&
          !tool.name.startsWith("ticket_"))),
  );
}

export const PAGE_BROWSER_TOOL_NAMES = new Set([
  "browser_navigate",
  "browser_snapshot",
  "browser_act",
]);

export function filterPageBrowserTools<T extends { name: string }>(
  tools: T[],
  pageBrowserAllowed: boolean,
): T[] {
  if (pageBrowserAllowed) return tools;
  return tools.filter((tool) => !PAGE_BROWSER_TOOL_NAMES.has(tool.name));
}

/** The fleet tools this run was offered, the same decision as tool selection. */
export function offeredFleetTools(tools: readonly { name: string }[]): string[] {
  return tools.map((tool) => tool.name).filter((name) => FLEET_TOOL_NAMES_SET.has(name));
}
