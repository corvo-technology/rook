import { unzipSync } from "fflate";

const SKILL_FILE_MAX_BYTES = 100_000;
const ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;
const SKILL_FILES_MAX = 500;

/**
 * The `SKILL.md` files of a zip, by path. Nothing else is inflated, and a file past the size a
 * skill may have is skipped, so an archive cannot expand beyond what is kept. Null when the bytes
 * are not a readable zip.
 */
export function readSkillArchive(data: Uint8Array): { path: string; content: string }[] | null {
  if (data.length > ARCHIVE_MAX_BYTES) return null;
  let kept = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (file) => {
        const wanted =
          file.originalSize <= SKILL_FILE_MAX_BYTES &&
          file.name.split("/").at(-1) === "SKILL.md" &&
          !file.name.split("/").includes("..") &&
          kept < SKILL_FILES_MAX;
        if (wanted) kept += 1;
        return wanted;
      },
    });
  } catch {
    return null;
  }
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return Object.entries(entries)
    .map(([path, bytes]) => ({ path, content: decoder.decode(bytes) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
