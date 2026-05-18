import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ThreadRelations = Record<string, string>;

export const threadRelationsPath = join(
  process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
  "opencode-threads",
  "threads.json",
);
// Remove this UI-only relationship store once OpenCode exposes enterable fork/thread nesting natively.
// Tracking issue: https://github.com/anomalyco/opencode/issues/16639

export function normalizeThreadRelations(input: unknown): ThreadRelations {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  return Object.fromEntries(
    Object.entries(input).filter(([childID, parentID]) => (
      childID !== "undefined"
      && typeof parentID === "string"
      && Boolean(childID && parentID)
    )),
  );
}

export async function readThreadRelations(): Promise<ThreadRelations> {
  try {
    return normalizeThreadRelations(JSON.parse(await readFile(threadRelationsPath, "utf8")));
  } catch {
    return {};
  }
}

export async function writeThreadRelations(relations: ThreadRelations) {
  await mkdir(dirname(threadRelationsPath), { recursive: true });
  await writeFile(threadRelationsPath, `${JSON.stringify(normalizeThreadRelations(relations), null, 2)}\n`);
}

export async function assignThreadParent(childID: string, parentID: string) {
  const normalized = normalizeThreadRelations({ [childID]: parentID });
  if (!normalized[childID]) throw new Error("Cannot record thread relation without valid child and parent IDs");

  const relations = await readThreadRelations();
  relations[childID] = parentID;
  await writeThreadRelations(relations);
}
