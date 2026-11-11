import type { FoundServer, MachineFindings } from "@corvo/adapters";
import {
  CLAUDE_ENGINE,
  cliEngineHost,
  LOCAL_MODEL_TEST_TIMEOUT_MS,
  LOCAL_PROVIDER_ID,
  LOOPBACK_MODEL_SERVERS,
  loadStoredModelSecret,
  localProvider,
  MODEL_CONNECT_CHECK_TIMEOUT_MS,
  parseModelSecret,
  pickBackgroundModelId,
  testModelOnce,
} from "@corvo/adapters";
import type {
  Actor,
  CliEngineStatus,
  LocalModelOption,
  LocalSetupReport,
  ModelCatalogEntry,
  ModelRole,
} from "@corvo/contracts";
import {
  CLI_ENGINE_PROVIDER_ID,
  canonicalPiProviderId,
  DISABLED_LOCAL_SETUP,
  MAX_ENABLED_MODEL_IDS,
  OPENAI_COMPATIBLE_PROVIDER_ID,
} from "@corvo/contracts";
import { pickCatalogModelId } from "@corvo/core";
import { appliedModelRole, newestModelCredentialOrder, updateModelRole } from "@corvo/db";
import { ORPCError } from "@orpc/server";
import { mayUsePrivateEndpoint } from "../mcp-servers.js";
import type { RouterDeps } from "../router.js";
import type { RouterContext } from "./context.js";

export const LOCAL_MODELS_LABEL = "Local models";

type ConnectionInput = {
  id: string;
  provider: string;
  label: string;
  defaultModel: string | null;
  kind: "api_key" | "oauth" | "openai_compatible";
  /** The list an openai-compatible connection serves; catalog providers use the catalog. */
  models?: string[];
};

function cliEngineLabel(id: CliEngineStatus["id"]): string {
  return [CLAUDE_ENGINE].find((engine) => engine.id === id)?.displayName ?? id;
}

type BackgroundCosts = Parameters<typeof pickBackgroundModelId>[0]["costs"];

/** Existing connection, then loopback server in port order, then operator-local models. */
export function buildLocalSetupReport(input: {
  findings: MachineFindings | null;
  checking: boolean;
  operatorModels: string[];
  connections: ConnectionInput[];
  catalog: ModelCatalogEntry[];
  /** Left out where CLI engines are not offered, so no CLI option or row appears. */
  cliEngines?: CliEngineStatus[];
  costs?: BackgroundCosts;
}): LocalSetupReport {
  const option = (
    base: Omit<LocalModelOption, "modelId" | "backgroundModelId" | "models"> & { models: string[] },
    preferred?: string | null,
  ): LocalModelOption | null => {
    const models = base.models.slice(0, MAX_ENABLED_MODEL_IDS);
    const modelId = preferred && models.includes(preferred) ? preferred : models[0];
    if (!modelId) return null;
    return {
      ...base,
      models,
      modelId,
      backgroundModelId: pickBackgroundModelId({
        provider: base.provider,
        models,
        mainModelId: modelId,
        costs: input.costs,
      }),
    };
  };
  const connections = input.connections.flatMap((connection) => {
    const provider = canonicalPiProviderId(connection.provider);
    const models =
      connection.kind === "openai_compatible"
        ? (connection.models ?? [])
        : input.catalog
            .filter(
              (entry) => canonicalPiProviderId(entry.provider) === provider && !entry.placeholder,
            )
            .map((entry) => entry.id);
    const preferred =
      connection.kind === "openai_compatible"
        ? connection.defaultModel
        : pickCatalogModelId(input.catalog, provider, connection.defaultModel);
    const found = option(
      {
        id: `connection:${connection.id}`,
        kind: "connection",
        label: connection.label,
        provider: connection.provider,
        credentialId: connection.id,
        models,
        testable: connection.kind !== "oauth",
      },
      preferred,
    );
    return found ? [found] : [];
  });
  const servers = [...(input.findings?.servers ?? [])]
    .sort(
      (left, right) =>
        LOOPBACK_MODEL_SERVERS.findIndex((server) => server.port === left.port) -
        LOOPBACK_MODEL_SERVERS.findIndex((server) => server.port === right.port),
    )
    .flatMap((server) => {
      const found = option({
        id: `server:${server.port}`,
        kind: "server",
        label: server.label,
        provider: OPENAI_COMPATIBLE_PROVIDER_ID,
        models: server.models,
        testable: true,
      });
      return found ? [found] : [];
    });
  const cliOptions = (input.cliEngines ?? []).flatMap((status) => {
    if (status.state !== "ready") return [];
    const found = option({
      id: `cli:${status.id}`,
      kind: "cli",
      label: cliEngineLabel(status.id),
      provider: CLI_ENGINE_PROVIDER_ID,
      models: status.models,
      // A plan sign-in was verified by the status check; a run is the only real test.
      testable: false,
    });
    return found ? [found] : [];
  });
  const local = option({
    id: "local",
    kind: "local",
    label: LOCAL_MODELS_LABEL,
    provider: LOCAL_PROVIDER_ID,
    models: input.operatorModels,
    testable: true,
  });
  return {
    enabled: true,
    checking: input.checking,
    checkedAt: input.findings?.checkedAt ?? null,
    options: [...connections, ...servers, ...cliOptions, ...(local ? [local] : [])],
    ...(input.cliEngines ? { cliEngines: input.cliEngines } : {}),
  };
}

export function localSetupRoutes(ctx: RouterContext) {
  const { deps, chatCatalog, connectModelCredential, validateRoleChoices, authed } = ctx;

  async function connectionInputs(actor: Actor): Promise<ConnectionInput[]> {
    const rows = await deps.prisma.userModelCredential.findMany({
      where: { userId: actor.userId },
      include: { userPreferences: { where: { userId: actor.userId } } },
      orderBy: newestModelCredentialOrder,
    });
    const found: ConnectionInput[] = [];
    for (const row of rows) {
      const secret = await loadStoredModelSecret(
        deps.prisma,
        deps.secrets,
        actor.userId,
        row.secretId,
      );
      if (secret.status !== "loaded") continue;
      let saved: ReturnType<typeof parseModelSecret>;
      try {
        saved = parseModelSecret(secret.plaintext);
      } catch {
        continue;
      }
      if (saved.kind !== "api_key" && saved.kind !== "oauth" && saved.kind !== "openai_compatible")
        continue;
      found.push({
        id: row.id,
        provider: row.provider,
        label: row.label,
        defaultModel: row.userPreferences[0]?.modelId ?? null,
        kind: saved.kind,
        ...(saved.kind === "openai_compatible" ? { models: saved.enabledModelIds ?? [] } : {}),
      });
    }
    return found;
  }

  async function report(
    actor: Actor,
    state: { findings: MachineFindings | null; checking: boolean },
  ): Promise<LocalSetupReport> {
    return buildLocalSetupReport({
      ...state,
      operatorModels:
        localProvider()
          ?.getModels()
          .map((model) => model.id) ?? [],
      connections: await connectionInputs(actor),
      catalog: await chatCatalog(actor),
      cliEngines: cliEngineHost() ? (state.findings?.cliEngines ?? []) : undefined,
    });
  }

  /** Resolves an option id against the server's own findings; no caller URL is ever read. */
  async function resolveLocalOption(
    actor: Actor,
    optionId: string,
    modelId: string,
  ): Promise<{ option: LocalModelOption; server?: FoundServer }> {
    if (!deps.localSetup) throw new ORPCError("NOT_FOUND");
    const state = deps.localSetup.current();
    const current = await report(actor, state);
    const option = current.options.find((candidate) => candidate.id === optionId);
    if (!option) throw new ORPCError("NOT_FOUND");
    if (!option.models.includes(modelId)) throw new ORPCError("BAD_REQUEST");
    const server =
      option.kind === "server"
        ? state.findings?.servers.find((candidate) => `server:${candidate.port}` === option.id)
        : undefined;
    return { option, ...(server ? { server } : {}) };
  }

  async function testConfig(
    actor: Actor,
    option: LocalModelOption,
    modelId: string,
    server?: FoundServer,
  ) {
    if (option.kind === "server" && server) {
      return {
        provider: OPENAI_COMPATIBLE_PROVIDER_ID,
        id: modelId,
        baseUrl: server.baseUrl,
        allowPrivateEndpoint: mayUsePrivateEndpoint(deps),
      };
    }
    if (option.kind === "local") return { provider: LOCAL_PROVIDER_ID, id: modelId };
    const row = await deps.prisma.userModelCredential.findFirst({
      where: { id: option.credentialId, userId: actor.userId },
    });
    if (!row) throw new ORPCError("NOT_FOUND");
    const secret = await loadStoredModelSecret(
      deps.prisma,
      deps.secrets,
      actor.userId,
      row.secretId,
    );
    if (secret.status !== "loaded") throw new ORPCError("NOT_FOUND");
    const saved = parseModelSecret(secret.plaintext);
    if (saved.kind === "api_key") {
      return {
        provider: row.provider,
        id: modelId,
        apiKey: saved.key,
        accountId: saved.accountId,
        gatewayId: saved.gatewayId,
        maxTokens: saved.maxTokens,
      };
    }
    if (saved.kind === "openai_compatible") {
      return {
        provider: OPENAI_COMPATIBLE_PROVIDER_ID,
        id: modelId,
        baseUrl: saved.baseUrl,
        apiKey: saved.apiKey,
        headers: saved.headers,
        maxTokens: saved.maxTokens,
        allowPrivateEndpoint: mayUsePrivateEndpoint(deps),
      };
    }
    // Sign-in connections are not testable: the executor owns their token refresh.
    throw new ORPCError("BAD_REQUEST");
  }

  /** Chores run on the cheaper model when the member has no choice of their own. */
  async function fillBackgroundRoles(
    actor: Actor,
    option: LocalModelOption,
    credentialId: string | undefined,
  ) {
    if (!option.backgroundModelId) return;
    const scope = { userId: actor.userId, spaceId: actor.spaceId };
    for (const role of ["fast", "approval"] as const satisfies readonly ModelRole[]) {
      if ((await appliedModelRole(deps.prisma, actor, role)).primary) continue;
      const primary = {
        provider: option.provider,
        modelId: option.backgroundModelId,
        ...(credentialId ? { credentialId } : {}),
      };
      try {
        await validateRoleChoices(actor, role, [primary]);
        await updateModelRole(deps.prisma, scope, role, { primary });
      } catch (error) {
        if (!(error instanceof ORPCError)) throw error;
      }
    }
  }

  return {
    models: {
      localSetup: authed.models.localSetup.handler(async ({ context, input }) => {
        const check = deps.localSetup;
        if (!check) return DISABLED_LOCAL_SETUP;
        const { actor } = context;
        if (input.wait) {
          const findings = await check.refresh();
          return report(actor, { findings, checking: false });
        }
        const state = check.current();
        if (!state.checking) check.refresh().catch(() => undefined);
        return report(actor, { findings: state.findings, checking: true });
      }),
      testLocal: authed.models.testLocal.handler(async ({ context, input }) => {
        const { actor } = context;
        const { option, server } = await resolveLocalOption(actor, input.optionId, input.modelId);
        if (!option.testable) throw new ORPCError("BAD_REQUEST");
        const run = deps.testLocalModel ?? testModelOnce;
        return run(await testConfig(actor, option, input.modelId, server), {
          fetch: deps.modelConnectionFetch,
          signal: context.signal,
          timeoutMs:
            option.kind === "connection"
              ? MODEL_CONNECT_CHECK_TIMEOUT_MS
              : LOCAL_MODEL_TEST_TIMEOUT_MS,
        });
      }),
      useLocal: authed.models.useLocal.handler(async ({ context, input }) => {
        const { actor, signal } = context;
        // A cached server may have stopped since it was found; never save a dead connection.
        if (
          deps.localSetup &&
          (input.optionId.startsWith("server:") || input.optionId.startsWith("cli:"))
        )
          await deps.localSetup.refresh();
        const { option, server } = await resolveLocalOption(actor, input.optionId, input.modelId);
        const modelId = input.modelId;
        let credentialId = option.credentialId;
        if (option.kind === "server" && server) {
          const saved = await connectModelCredential(
            actor,
            {
              provider: OPENAI_COMPATIBLE_PROVIDER_ID,
              baseUrl: server.baseUrl,
              modelId,
              label: server.label,
              credentialId: null,
              makeDefault: true,
              enabledModelIds: server.models,
            },
            signal,
          );
          credentialId = saved.id;
        } else {
          const primary = {
            provider: option.provider,
            modelId,
            ...(credentialId ? { credentialId } : {}),
          };
          await validateRoleChoices(actor, "main", [primary]);
          await updateModelRole(
            deps.prisma,
            { userId: actor.userId, spaceId: actor.spaceId },
            "main",
            { primary },
          );
        }
        await fillBackgroundRoles(actor, option, credentialId);
        return { ok: true as const };
      }),
    },
  };
}
