import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertComputerHomeWritable,
  assertOpenedDirectoryBeneathRoot,
  ensureOwnedHome,
  isHomeKey,
} from "./home-ownership.js";

const roots: string[] = [];
const DIRECTORY_OPEN_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("computer home ownership", () => {
  it("rejects a missing home instead of creating it as root", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-missing-"));
    roots.push(parent);

    await expect(
      assertComputerHomeWritable(path.join(parent, "missing"), 1000, 1000),
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects a symlink as the home root", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-root-link-"));
    roots.push(parent);
    const outside = path.join(parent, "outside");
    const home = path.join(parent, "home");
    await mkdir(outside);
    await symlink(outside, home);

    await expect(assertComputerHomeWritable(home, 1000, 1000)).rejects.toThrow(/symbolic link/);
  });

  it("rejects a writable regular file as the home root", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-file-root-"));
    roots.push(parent);
    const home = path.join(parent, "home");
    await writeFile(home, "{}");
    await chmod(home, 0o600);

    const stat = await lstat(home);
    await expect(assertComputerHomeWritable(home, stat.uid, stat.gid)).rejects.toThrow(
      /must be a directory/,
    );
  });

  it("rejects an existing entry that the host-run computer cannot write", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-writable-"));
    roots.push(parent);
    const home = path.join(parent, "home");
    const file = path.join(home, "profile.json");
    await mkdir(home);
    await chmod(home, 0o777);
    await writeFile(file, "{}");
    await chmod(file, 0o400);

    const stat = await lstat(home);
    await expect(assertComputerHomeWritable(home, stat.uid + 1, stat.gid + 1)).rejects.toThrow(
      /chown -R/,
    );
  });

  it("accepts writable files owned by the sandbox user", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-writable-file-"));
    roots.push(parent);
    const home = path.join(parent, "home");
    const file = path.join(home, "profile.json");
    await mkdir(home);
    await writeFile(file, "{}");
    await chmod(file, 0o644);

    const stat = await lstat(file);
    await expect(assertComputerHomeWritable(home, stat.uid, stat.gid)).resolves.toBeUndefined();
  });

  it("accepts sandbox-owned read-only git object files", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-git-object-"));
    roots.push(parent);
    const home = path.join(parent, "home");
    const object = path.join(home, "repo", ".git", "objects", "ab", "cdef");
    await mkdir(path.dirname(object), { recursive: true });
    await writeFile(object, "blob");
    await chmod(object, 0o444);

    const stat = await lstat(object);
    await expect(assertComputerHomeWritable(home, stat.uid, stat.gid)).resolves.toBeUndefined();
  });

  it("rejects a read-only file owned by someone else", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-foreign-readonly-"));
    roots.push(parent);
    const home = path.join(parent, "home");
    const file = path.join(home, "object");
    await mkdir(home);
    await chmod(home, 0o777);
    await writeFile(file, "blob");
    await chmod(file, 0o444);

    const stat = await lstat(file);
    await expect(assertComputerHomeWritable(home, stat.uid + 1, stat.gid + 1)).rejects.toThrow(
      /chown -R/,
    );
  });

  it("rejects an owner-owned file the owner cannot read", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-unreadable-"));
    roots.push(parent);
    const home = path.join(parent, "home");
    const file = path.join(home, "profile.json");
    await mkdir(home);
    await writeFile(file, "{}");
    await chmod(file, 0o000);

    const stat = await lstat(file);
    await expect(assertComputerHomeWritable(home, stat.uid, stat.gid)).rejects.toThrow(/chown -R/);
  });

  it("rejects an owner-owned world-writable file the owner cannot write", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-world-writable-"));
    roots.push(parent);
    const home = path.join(parent, "home");
    const file = path.join(home, "profile.json");
    await mkdir(home);
    await writeFile(file, "{}");
    await chmod(file, 0o002);

    const stat = await lstat(file);
    await expect(assertComputerHomeWritable(home, stat.uid, stat.gid)).rejects.toThrow(/chown -R/);
  });

  it("rejects an owner-owned directory that is not writable", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-dir-mode-"));
    roots.push(parent);
    const home = path.join(parent, "home");
    await mkdir(home);
    await chmod(home, 0o555);

    const stat = await lstat(home);
    await expect(assertComputerHomeWritable(home, stat.uid, stat.gid)).rejects.toThrow(/chown -R/);
  });

  it("does not follow symlinks while checking host-run compatibility", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-writable-link-"));
    roots.push(parent);
    const home = path.join(parent, "home");
    const outside = path.join(parent, "outside");
    await mkdir(home);
    await writeFile(outside, "outside");
    await chmod(outside, 0o400);
    await symlink(outside, path.join(home, "link"));

    const stat = await lstat(home);
    await expect(assertComputerHomeWritable(home, stat.uid, stat.gid)).resolves.toBeUndefined();
  });

  it.skipIf(process.platform !== "linux")(
    "rejects an opened directory that was moved outside the home",
    async () => {
      const parent = await mkdtemp(path.join(tmpdir(), "corvo-home-moved-"));
      roots.push(parent);
      const home = path.join(parent, "home");
      const outside = path.join(parent, "outside");
      const child = path.join(home, "nested");
      await mkdir(child, { recursive: true });
      await mkdir(outside, { recursive: true });
      const handle = await open(child, DIRECTORY_OPEN_FLAGS);
      try {
        await rename(child, path.join(outside, "nested"));
        await expect(assertOpenedDirectoryBeneathRoot(handle, home)).rejects.toThrow(
          /escaped validated root/,
        );
      } finally {
        await handle.close();
      }
    },
  );
});

describe("a home this supervisor's host owns", () => {
  const owner = { uid: 1000, gid: 1000 };
  const dataDir = async () => {
    const root = await mkdtemp(path.join(tmpdir(), "corvo-owned-home-"));
    roots.push(root);
    return root;
  };

  it("names one folder or nothing", () => {
    for (const key of ["bot-1", "team-0f3a", "A_b-9"]) expect(isHomeKey(key)).toBe(true);
    for (const key of ["", "..", "../x", "a/b", ".hidden", "a b", "x".repeat(129), "bot\0"]) {
      expect(isHomeKey(key), key).toBe(false);
    }
  });

  it("creates the home under the data directory and returns its path", async () => {
    const root = await dataDir();
    const home = await ensureOwnedHome(root, "bot-1", owner);
    expect(home).toBe(path.join(root, "homes", "bot-1"));
    expect((await lstat(home)).isDirectory()).toBe(true);
  });

  it("leaves a home that already holds files as it is", async () => {
    const root = await dataDir();
    const home = await ensureOwnedHome(root, "bot-1", owner);
    await writeFile(path.join(home, "keep.txt"), "kept");
    await expect(ensureOwnedHome(root, "bot-1", owner)).resolves.toBe(home);
    expect((await lstat(path.join(home, "keep.txt"))).isFile()).toBe(true);
  });

  it("refuses a key that could name another place, creating nothing", async () => {
    const root = await dataDir();
    await expect(ensureOwnedHome(root, "../escape", owner)).rejects.toThrow("not a valid");
    await expect(lstat(path.join(root, "escape"))).rejects.toThrow();
  });

  it("refuses a link or a file where the home should be", async () => {
    const root = await dataDir();
    await mkdir(path.join(root, "homes"), { recursive: true });
    await symlink(tmpdir(), path.join(root, "homes", "linked"));
    await writeFile(path.join(root, "homes", "file"), "x");
    await expect(ensureOwnedHome(root, "linked", owner)).rejects.toThrow("symbolic link");
    await expect(ensureOwnedHome(root, "file", owner)).rejects.toThrow("must be a directory");
  });
});
