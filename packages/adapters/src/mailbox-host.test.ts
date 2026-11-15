import { describe, expect, it } from "vitest";
import { resolveMailHost } from "./mailbox-host.js";

const resolveTo = (address: string) => async () => [
  { address, family: address.includes(":") ? 6 : 4 },
];

describe("resolveMailHost", () => {
  it("returns the public address the connection must use", async () => {
    await expect(
      resolveMailHost("imap.example.test", { resolveHostname: resolveTo("93.184.216.34") }),
    ).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });

  it.each([
    "localhost",
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.10",
    "172.16.0.1",
    "169.254.169.254",
    "[::1]",
    "metadata.google.internal",
    "mail.internal",
    "printer.local",
  ])("refuses the private host %s on the cloud", async (host) => {
    await expect(
      resolveMailHost(host, { resolveHostname: resolveTo("93.184.216.34") }),
    ).rejects.toThrow(/private|invalid/i);
  });

  it("refuses a public name that resolves to a private or metadata address", async () => {
    for (const address of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "fd00::1"]) {
      await expect(
        resolveMailHost("rebind.example.test", { resolveHostname: resolveTo(address) }),
      ).rejects.toThrow(/private/i);
    }
  });

  it("refuses when any answer is private, not only the first", async () => {
    await expect(
      resolveMailHost("mixed.example.test", {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.9", family: 4 },
        ],
      }),
    ).rejects.toThrow(/private/i);
  });

  it("rejects hosts that are not host names", async () => {
    for (const host of ["a b", "mail.test/path", "mail.test:25", "", "-x"])
      await expect(resolveMailHost(host)).rejects.toThrow();
  });

  it("lets the operator reach a mail server on the same network, but never metadata", async () => {
    await expect(
      resolveMailHost("mail.lan.test", {
        allowPrivateEndpoint: true,
        resolveHostname: resolveTo("192.168.1.10"),
      }),
    ).resolves.toMatchObject({ address: "192.168.1.10" });
    await expect(
      resolveMailHost("169.254.169.254", { allowPrivateEndpoint: true }),
    ).rejects.toThrow(/private/i);
  });
});
