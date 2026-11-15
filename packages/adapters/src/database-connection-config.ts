import type { DatabaseConnectionInput, DatabaseSslMode } from "@corvo/contracts";
import { DatabaseSslModeSchema } from "@corvo/contracts";

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: DatabaseSslMode;
}

const SSL_ALIASES: Record<string, DatabaseSslMode> = {
  disable: "disable",
  allow: "require",
  prefer: "require",
  require: "require",
  "verify-ca": "verify-full",
  "verify-full": "verify-full",
};

/** A connection string or its parts, as one config. Throws a message fit to show a person. */
export function databaseConfigFromInput(input: DatabaseConnectionInput): DatabaseConfig {
  const fallbackSsl = input.sslMode ?? "require";
  if (!input.connectionString) {
    return {
      host: input.host ?? "",
      port: input.port ?? 5432,
      database: input.database ?? "",
      user: input.user ?? "",
      password: input.password ?? "",
      sslMode: fallbackSsl,
    };
  }
  let url: URL;
  try {
    url = new URL(input.connectionString);
  } catch {
    throw new Error("That connection string is not valid");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Use a postgres:// connection string");
  }
  const query = url.searchParams.get("sslmode");
  const fromQuery = query ? SSL_ALIASES[query.toLowerCase()] : undefined;
  if (query && !fromQuery) throw new Error("That sslmode is not supported");
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return {
    host: input.host ?? url.hostname.replace(/^\[|\]$/g, ""),
    port: input.port ?? (url.port ? Number(url.port) : 5432),
    database: input.database ?? decode(url.pathname.replace(/^\//, "")),
    user: input.user ?? decode(url.username),
    password: input.password ?? decode(url.password),
    sslMode: DatabaseSslModeSchema.parse(input.sslMode ?? fromQuery ?? "require"),
  };
}

/** What a stored connection needs to connect: the password comes from the secret store. */
export function validateDatabaseConfig(config: DatabaseConfig): string | undefined {
  if (!config.host) return "Enter the database host";
  if (!/^[A-Za-z0-9.:_\-[\]]+$/.test(config.host)) return "That host is not valid";
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    return "That port is not valid";
  }
  if (!config.database) return "Enter the database name";
  if (!config.user) return "Enter the database user";
  return undefined;
}
