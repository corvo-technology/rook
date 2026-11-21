/**
 * What the Chief keeps an eye on in the background. The routine row is made by the system, so the
 * person never approves it; the text is theirs to edit in Routines. The change check behind it
 * reads the task board without a model, so a quiet board costs nothing.
 */
export const CHIEF_WATCH_ROUTINE_NAME = "Watch";
export const CHIEF_WATCH_TEMPLATE_KEY = "chief-watch";
export const CHIEF_WATCH_EVERY_MINUTES = 30;

export const CHIEF_WATCH_PROMPT = `Keep an eye on what could cost the person something, and speak only when something needs them. Checklist (edit it freely). Each item applies only if its app is connected; skip the ones that are not, without saying so:
- Calendar: an upcoming meeting that overlaps another commitment.
- Email: an important message still waiting for an answer.
- Board: a ticket that is blocked or stuck.
- Deploys: a deploy that is failing.
Check what you already told them before raising anything, and stay quiet about what has not changed. When something does need them, do the analysis first: read the details, look for the free slot or the cause, decide what you recommend, do what is yours to do safely, and end with one offer or question. Never change, send or cancel anything on your own.`;
