import { describe, expect, it } from "vitest";
import { accessRevocations } from "./access-revocations.js";

describe("access revocations", () => {
  it("ends the streams of the removed member in that space only", async () => {
    const ended: string[] = [];
    void accessRevocations.watch("s1", "u1").then(() => ended.push("u1@s1"));
    void accessRevocations.watch("s1", "u2").then(() => ended.push("u2@s1"));
    void accessRevocations.watch("s2", "u1").then(() => ended.push("u1@s2"));
    accessRevocations.revoke("s1", "u1");
    await Promise.resolve();
    expect(ended).toEqual(["u1@s1"]);
  });

  it("forgets a stream that closed on its own", async () => {
    const controller = new AbortController();
    let ended = false;
    void accessRevocations.watch("s3", "u3", controller.signal).then(() => {
      ended = true;
    });
    controller.abort();
    accessRevocations.revoke("s3", "u3");
    await Promise.resolve();
    expect(ended).toBe(false);
  });
});
