import { describe, expect, it } from "vitest";
import { idleSleepSeconds, leadingSleepSeconds } from "./idle-sleep.js";

describe("leadingSleepSeconds", () => {
  it.each([
    ["sleep 45", 45],
    ["  sleep 2m; ls", 120],
    ["sleep 1.5h", 5400],
    ["(sleep 30)", 30],
    ["sleepy 30", 0],
    ["npm test", 0],
    ["while ! nc -z localhost 5432; do sleep 5; done", 0],
  ])("reads %j as %i seconds", (command, seconds) => {
    expect(leadingSleepSeconds(command)).toBe(seconds);
  });
});

describe("idleSleepSeconds", () => {
  it.each([
    ["sleep 45", 45],
    ["sleep 45 && echo waiting 3", 45],
    ["sleep 1m; date", 60],
    ["sleep 45 && true", 45],
    ["sleep 30 && nc -z localhost 5432", 0],
    ["sleep 45; git status", 0],
    ["sleep 45 && echo done > marker.txt", 0],
    ["echo hi && sleep 45", 0],
    ["", 0],
  ])("reads %j as %i seconds", (command, seconds) => {
    expect(idleSleepSeconds(command)).toBe(seconds);
  });
});
