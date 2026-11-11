import { ORPCError } from "@orpc/server";
import type { RouterContext } from "./context.js";

/**
 * Installing and signing in to coding-agent CLIs. Every procedure is forbidden where the engine
 * does not offer CLI engines, so a hosted deployment with billing never runs any of it.
 */
export function enginesRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const service = () => {
    if (!deps.cliEngineSetup) throw new ORPCError("FORBIDDEN");
    return deps.cliEngineSetup;
  };
  return {
    engines: {
      setupState: authed.engines.setupState.handler(async () => service().setup()),
      install: authed.engines.install.handler(async ({ input }) => {
        const state = await service().install(input.id);
        // A fresh install changes what the model step finds.
        if (state === "installed") await deps.localSetup?.refresh().catch(() => undefined);
        return { state };
      }),
      signIn: authed.engines.signIn.handler(async ({ input }) => {
        const started = await service().signIn(input.id);
        if (!started) throw new ORPCError("BAD_REQUEST");
        return started;
      }),
      loginScreen: authed.engines.loginScreen.handler(async ({ input }) => {
        const session = service().session(input.sessionId);
        if (!session) throw new ORPCError("NOT_FOUND");
        if (session.state === "done") await deps.localSetup?.refresh().catch(() => undefined);
        return session;
      }),
      loginInput: authed.engines.loginInput.handler(async ({ input }) => {
        const { sessionId, ...typed } = input;
        if (!service().input(sessionId, typed)) throw new ORPCError("NOT_FOUND");
        return { ok: true as const };
      }),
      cancelLogin: authed.engines.cancelLogin.handler(async ({ input }) => {
        if (!service().cancel(input.sessionId)) throw new ORPCError("NOT_FOUND");
        return { ok: true as const };
      }),
    },
  };
}
