import { agents } from "./pages/agents.js";
import { approvals } from "./pages/approvals.js";
import { board } from "./pages/board.js";
import { connectors } from "./pages/connectors.js";
import { gettingStarted } from "./pages/getting-started.js";
import { limits } from "./pages/limits.js";
import { memory } from "./pages/memory.js";
import { mobile } from "./pages/mobile.js";
import { models } from "./pages/models.js";
import { routines } from "./pages/routines.js";
import { selfHosting } from "./pages/self-hosting.js";
import { skills } from "./pages/skills.js";
import { team } from "./pages/team.js";
import { troubleshooting } from "./pages/troubleshooting.js";
import { wiki } from "./pages/wiki.js";
import type { GuidePage } from "./types.js";

/** The product guide, sorted by slug. */
export const GUIDE_PAGES: readonly GuidePage[] = [
  agents,
  approvals,
  board,
  connectors,
  gettingStarted,
  limits,
  memory,
  mobile,
  models,
  routines,
  selfHosting,
  skills,
  team,
  troubleshooting,
  wiki,
].sort((a, b) => a.slug.localeCompare(b.slug));
