import type { RunErrorTranslator } from "@corvo/core";
import { i18n } from "@lingui/core";

/** Static descriptors keep shared run-error messages in Lingui extraction. */
export const translateRunError: RunErrorTranslator = (message, values) => {
  switch (message) {
    case "Image input is not configured for this model.":
      return i18n._({
        id: "Image input is not configured for this model.",
        message: "Image input is not configured for this model.",
        values,
      });
    case "This model cannot read images. Choose a model that supports images.":
      return i18n._({
        id: "This model cannot read images. Choose a model that supports images.",
        message: "This model cannot read images. Choose a model that supports images.",
        values,
      });
    case "Your OpenRouter":
      return i18n._({ id: "Your OpenRouter", message: "Your OpenRouter", values });
    case "Your OpenAI":
      return i18n._({ id: "Your OpenAI", message: "Your OpenAI", values });
    case "Your Anthropic":
      return i18n._({ id: "Your Anthropic", message: "Your Anthropic", values });
    case "Your model provider":
      return i18n._({ id: "Your model provider", message: "Your model provider", values });
    case "Connect a model in Settings before running bots.":
      return i18n._({
        id: "Connect a model in Settings before running bots.",
        message: "Connect a model in Settings before running bots.",
        values,
      });
    case "Connect your own API key in Models or choose Rook credits in Billing.":
      return i18n._({
        id: "Connect your own API key in Models or choose Rook credits in Billing.",
        message: "Connect your own API key in Models or choose Rook credits in Billing.",
        values,
      });
    case "The model provider returned an error.":
      return i18n._({
        id: "The model provider returned an error.",
        message: "The model provider returned an error.",
        values,
      });
    case "{provider} is rate limiting requests. Try again shortly.":
      return i18n._({
        id: "{provider} is rate limiting requests. Try again shortly.",
        message: "{provider} is rate limiting requests. Try again shortly.",
        values,
      });
    case "{summary} Resets {date}.":
      return i18n._({
        id: "{summary} Resets {date}.",
        message: "{summary} Resets {date}.",
        values,
      });
    case "{provider} rejected the API key. Check your connection settings.":
      return i18n._({
        id: "{provider} rejected the API key. Check your connection settings.",
        message: "{provider} rejected the API key. Check your connection settings.",
        values,
      });
    case "{provider} can't run this model.":
      return i18n._({
        id: "{provider} can't run this model.",
        message: "{provider} can't run this model.",
        values,
      });
    case "{provider} denied access to this model.":
      return i18n._({
        id: "{provider} denied access to this model.",
        message: "{provider} denied access to this model.",
        values,
      });
    case "The model returned an unusable response. Try again.":
      return i18n._({
        id: "The model returned an unusable response. Try again.",
        message: "The model returned an unusable response. Try again.",
        values,
      });
    case "The model hit its output limit before finishing its reply.":
      return i18n._({
        id: "The model hit its output limit before finishing its reply.",
        message: "The model hit its output limit before finishing its reply.",
        values,
      });
    case "This model's context window is too small. Choose another model.":
      return i18n._({
        id: "This model's context window is too small. Choose another model.",
        message: "This model's context window is too small. Choose another model.",
        values,
      });
    case "{provider} took too long to respond. Try again.":
      return i18n._({
        id: "{provider} took too long to respond. Try again.",
        message: "{provider} took too long to respond. Try again.",
        values,
      });
    case "{provider} couldn't be reached securely. A security program or network filter may be intercepting the connection.":
      return i18n._({
        id: "{provider} couldn't be reached securely. A security program or network filter may be intercepting the connection.",
        message:
          "{provider} couldn't be reached securely. A security program or network filter may be intercepting the connection.",
        values,
      });
    case "{provider} couldn't be reached. Check that it's running.":
      return i18n._({
        id: "{provider} couldn't be reached. Check that it's running.",
        message: "{provider} couldn't be reached. Check that it's running.",
        values,
      });
    case "{provider} sign-in is no longer valid.":
      return i18n._({
        id: "{provider} sign-in is no longer valid.",
        message: "{provider} sign-in is no longer valid.",
        values,
      });
    case "{provider} couldn't be reached through the network proxy. Check the proxy settings.":
      return i18n._({
        id: "{provider} couldn't be reached through the network proxy. Check the proxy settings.",
        message:
          "{provider} couldn't be reached through the network proxy. Check the proxy settings.",
        values,
      });
    case "{provider} is overloaded right now. Try again in a moment.":
      return i18n._({
        id: "{provider} is overloaded right now. Try again in a moment.",
        message: "{provider} is overloaded right now. Try again in a moment.",
        values,
      });
    case "This conversation is too long for the model. Retrying won't help. Start a new chat or shorten your message.":
      return i18n._({
        id: "This conversation is too long for the model. Retrying won't help. Start a new chat or shorten your message.",
        message:
          "This conversation is too long for the model. Retrying won't help. Start a new chat or shorten your message.",
        values,
      });
    case "{provider} key hit its limit.":
      return i18n._({
        id: "{provider} key hit its limit.",
        message: "{provider} key hit its limit.",
        values,
      });
    case "{provider} key hit its daily limit.":
      return i18n._({
        id: "{provider} key hit its daily limit.",
        message: "{provider} key hit its daily limit.",
        values,
      });
    case "{provider} key hit its weekly limit.":
      return i18n._({
        id: "{provider} key hit its weekly limit.",
        message: "{provider} key hit its weekly limit.",
        values,
      });
    case "{provider} key hit its monthly limit.":
      return i18n._({
        id: "{provider} key hit its monthly limit.",
        message: "{provider} key hit its monthly limit.",
        values,
      });
    case "{provider} reached its credit limit.":
      return i18n._({
        id: "{provider} reached its credit limit.",
        message: "{provider} reached its credit limit.",
        values,
      });
    case "{provider} reached its daily credit limit.":
      return i18n._({
        id: "{provider} reached its daily credit limit.",
        message: "{provider} reached its daily credit limit.",
        values,
      });
    case "{provider} reached its weekly credit limit.":
      return i18n._({
        id: "{provider} reached its weekly credit limit.",
        message: "{provider} reached its weekly credit limit.",
        values,
      });
    case "{provider} reached its monthly credit limit.":
      return i18n._({
        id: "{provider} reached its monthly credit limit.",
        message: "{provider} reached its monthly credit limit.",
        values,
      });
    case "{provider} reached its spending limit.":
      return i18n._({
        id: "{provider} reached its spending limit.",
        message: "{provider} reached its spending limit.",
        values,
      });
    case "{provider} reached its daily spending limit.":
      return i18n._({
        id: "{provider} reached its daily spending limit.",
        message: "{provider} reached its daily spending limit.",
        values,
      });
    case "{provider} reached its weekly spending limit.":
      return i18n._({
        id: "{provider} reached its weekly spending limit.",
        message: "{provider} reached its weekly spending limit.",
        values,
      });
    case "{provider} reached its monthly spending limit.":
      return i18n._({
        id: "{provider} reached its monthly spending limit.",
        message: "{provider} reached its monthly spending limit.",
        values,
      });
    case "{summary} Your backup models also failed.":
      return i18n._({
        id: "{summary} Your backup models also failed.",
        message: "{summary} Your backup models also failed.",
        values,
      });
    case "{summary} No backup model was usable for this request.":
      return i18n._({
        id: "{summary} No backup model was usable for this request.",
        message: "{summary} No backup model was usable for this request.",
        values,
      });
    case "{summary} Backup models failed or were unavailable for this request.":
      return i18n._({
        id: "{summary} Backup models failed or were unavailable for this request.",
        message: "{summary} Backup models failed or were unavailable for this request.",
        values,
      });
    case "This bot reached its monthly token limit.":
      return i18n._({
        id: "This bot reached its monthly token limit.",
        message: "This bot reached its monthly token limit.",
        values,
      });
    case "You reached your monthly limit on this space's model.":
      return i18n._({
        id: "You reached your monthly limit on this space's model.",
        message: "You reached your monthly limit on this space's model.",
        values,
      });
    case "This space's model is a personal sign-in and only its owner can use it.":
      return i18n._({
        id: "This space's model is a personal sign-in and only its owner can use it.",
        message: "This space's model is a personal sign-in and only its owner can use it.",
        values,
      });
    case "This reply reached its token cap.":
      return i18n._({
        id: "This reply reached its token cap.",
        message: "This reply reached its token cap.",
        values,
      });
    case "Bots are paused in this space.":
      return i18n._({
        id: "Bots are paused in this space.",
        message: "Bots are paused in this space.",
        values,
      });
    case "I stopped because I kept repeating the same step and getting the same result.":
      return i18n._({
        id: "I stopped because I kept repeating the same step and getting the same result.",
        message: "I stopped because I kept repeating the same step and getting the same result.",
        values,
      });
    case "I stopped because my tools kept failing.":
      return i18n._({
        id: "I stopped because my tools kept failing.",
        message: "I stopped because my tools kept failing.",
        values,
      });
    case "I stopped because I got stuck and nothing was moving.":
      return i18n._({
        id: "I stopped because I got stuck and nothing was moving.",
        message: "I stopped because I got stuck and nothing was moving.",
        values,
      });
    case "I stopped because I kept waiting for something that didn't arrive.":
      return i18n._({
        id: "I stopped because I kept waiting for something that didn't arrive.",
        message: "I stopped because I kept waiting for something that didn't arrive.",
        values,
      });
    case "Claude Code isn't installed where this bot runs.":
      return i18n._({
        id: "Claude Code isn't installed where this bot runs.",
        message: "Claude Code isn't installed where this bot runs.",
        values,
      });
    case "Claude Code isn't signed in to a Claude plan where this bot runs.":
      return i18n._({
        id: "Claude Code isn't signed in to a Claude plan where this bot runs.",
        message: "Claude Code isn't signed in to a Claude plan where this bot runs.",
        values,
      });
    case "Claude Code started with tools it wasn't given, so the reply was stopped.":
      return i18n._({
        id: "Claude Code started with tools it wasn't given, so the reply was stopped.",
        message: "Claude Code started with tools it wasn't given, so the reply was stopped.",
        values,
      });
    default:
      return message;
  }
};
