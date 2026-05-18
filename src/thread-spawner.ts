import { SessionGateway } from "./session-gateway";
import { readThreadRelations, writeThreadRelations } from "./thread-relations";

export type SpawnThreadInput = {
  title: string;
  prompt: string;
};

export type SpawnedThread = {
  id: string;
  title: string;
};

export async function spawnThreadSessions(
  gateway: SessionGateway,
  parentSessionID: string,
  threads: SpawnThreadInput[],
): Promise<SpawnedThread[]> {
  if (!parentSessionID) throw new Error("Cannot spawn threads without a parent session ID");

  const created: SpawnedThread[] = [];
  const relations = await readThreadRelations();

  for (const thread of threads) {
    const { id } = await gateway.createOrFork(thread.title, parentSessionID);
    if (!id) throw new Error(`Failed to create thread session for ${thread.title}`);

    relations[id] = parentSessionID;
    await gateway.sendPrompt(id, thread.prompt);
    created.push({ id, title: thread.title });
  }

  await writeThreadRelations(relations);
  return created;
}

export function formatSpawnedThreads(created: SpawnedThread[]): string {
  return created.length
    ? `Spawned ${created.length} thread(s):\n${created.map((item) => `- ${item.title}: ${item.id}`).join("\n")}`
    : "No threads were spawned.";
}
