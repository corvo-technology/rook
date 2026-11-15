import * as z from "zod";

/** How the connection to the database is encrypted. `require` encrypts without checking the certificate. */
export const DATABASE_SSL_MODES = ["require", "verify-full", "disable"] as const;
export const DatabaseSslModeSchema = z.enum(DATABASE_SSL_MODES);
export type DatabaseSslMode = z.infer<typeof DatabaseSslModeSchema>;

const Id = z.string().min(1).max(128);

/** What a person fills in: a connection string, or the parts. The password is only ever input. */
export const DatabaseConnectionInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    connectionString: z.string().trim().max(2048).optional(),
    host: z.string().trim().max(253).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    database: z.string().trim().max(128).optional(),
    user: z.string().trim().max(128).optional(),
    password: z.string().max(1024).optional(),
    sslMode: DatabaseSslModeSchema.optional(),
  })
  .refine((value) => value.connectionString || (value.host && value.database && value.user), {
    message: "Enter a connection string, or a host, database and user",
  });
export type DatabaseConnectionInput = z.infer<typeof DatabaseConnectionInput>;

/** A saved connection as shown to people. It never carries the password. */
export const DatabaseConnectionSchema = z.object({
  id: Id,
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  database: z.string(),
  user: z.string(),
  sslMode: DatabaseSslModeSchema,
  /** Result of the last connection test; null before the first one. */
  testedOk: z.boolean().nullable(),
  /** The agents allowed to query it. */
  botIds: z.array(Id),
  createdAt: z.string(),
});
export type DatabaseConnection = z.infer<typeof DatabaseConnectionSchema>;

export const DATABASE_TOOL_NAMES = ["query_database", "describe_database"] as const;
