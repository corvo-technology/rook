import { createVaultService } from "../vault.js";
import type { RouterContext } from "./context.js";

export function vaultRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const service = createVaultService({ prisma: deps.prisma, secrets: deps.secrets });
  return {
    vault: {
      list: authed.vault.list.handler(({ context }) => service.list(context.actor)),
      create: authed.vault.create.handler(({ context, input }) =>
        service.create(context.actor, input),
      ),
      replace: authed.vault.replace.handler(({ context, input }) =>
        service.replace(context.actor, input.id, input.value),
      ),
      setAgents: authed.vault.setAgents.handler(({ context, input }) =>
        service.setAgents(context.actor, input.id, input.botIds),
      ),
      remove: authed.vault.remove.handler(async ({ context, input }) => {
        await service.remove(context.actor, input.id);
        return { ok: true as const };
      }),
      uses: authed.vault.uses.handler(({ context, input }) =>
        service.uses(context.actor, input.id),
      ),
    },
  };
}
