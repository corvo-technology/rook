/** Ports where the connection is encrypted from the first byte; the others upgrade with STARTTLS. */
const IMPLICIT_TLS_PORTS = new Set([993, 465]);

/** "imap.example.com" or "imap.example.com:143" as the host, port and encryption a mailbox saves. */
export function parseMailServer(
  value: string,
  defaultPort: number,
): { host: string; port: number; secure: boolean } | null {
  const match = /^\s*([A-Za-z0-9.-]+)(?::(\d{1,5}))?\s*$/.exec(value);
  if (!match) return null;
  const port = match[2] ? Number(match[2]) : defaultPort;
  if (port < 1 || port > 65535) return null;
  return { host: match[1]!, port, secure: IMPLICIT_TLS_PORTS.has(port) };
}
