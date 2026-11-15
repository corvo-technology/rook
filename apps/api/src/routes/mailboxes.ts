import { createMailboxService } from "../mailboxes.js";
import { mayUsePrivateEndpoint } from "../mcp-servers.js";
import type { RouterContext } from "./context.js";

export function mailboxRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const service = createMailboxService({
    prisma: deps.prisma,
    secrets: deps.secrets,
    allowPrivateEndpoint: mayUsePrivateEndpoint(deps),
    resolveHostname: deps.remoteConnectors?.resolveHostname,
  });
  return {
    mailboxes: {
      list: authed.mailboxes.list.handler(({ context }) => service.list(context.actor)),
      create: authed.mailboxes.create.handler(({ context, input }) =>
        service.create(context.actor, input, context.signal ?? new AbortController().signal),
      ),
      remove: authed.mailboxes.remove.handler(async ({ context, input }) => {
        await service.remove(context.actor, input.id);
        return { ok: true as const };
      }),
      setAgents: authed.mailboxes.setAgents.handler(({ context, input }) =>
        service.setAgents(context.actor, input.id, input.botIds),
      ),
    },
  };
}
