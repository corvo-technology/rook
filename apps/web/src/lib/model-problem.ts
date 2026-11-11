import type {
  ModelProblem,
  ModelProblemAction,
  ModelProblemOptions,
  RunErrorTranslator,
} from "@corvo/core";
import { describeModelProblem, modelProblemFromError } from "@corvo/core";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { translateRunError } from "./run-error";

type AuthKind = ModelProblemOptions["authKind"];

/** The offline line is the one every screen already shows; it keeps its existing catalog entry. */
const translate: RunErrorTranslator = (message, values) =>
  message === "Could not reach the server"
    ? t`Could not reach the server`
    : translateRunError(message, values);

function options(authKind: AuthKind): ModelProblemOptions {
  return { authKind, translate, locale: i18n.locale || "en" };
}

/** A failed model call (probe, connect, save) as one line, one action and masked details. */
export function webModelProblem(
  error: unknown,
  fallback: string,
  authKind?: AuthKind,
): ModelProblem {
  return modelProblemFromError(error, fallback, options(authKind));
}

/** A failed chat run, from the error text saved on the run. */
export function webRunProblem(details: string, authKind?: AuthKind): ModelProblem {
  return describeModelProblem({ details }, options(authKind));
}

export function modelProblemActionLabel(action: ModelProblemAction): string {
  switch (action) {
    case "sign-in":
      return t`Sign in again`;
    case "replace-key":
      return t`Replace key`;
    case "connect":
      return t`Connect a model`;
    case "change-model":
      return t`Choose a model`;
  }
}
