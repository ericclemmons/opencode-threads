import { tool, type Plugin } from "@opencode-ai/plugin";
import { buildCoordinatorPrompt } from "./coordinator-prompt";
import { coordinatorContextLines, orderedMessages } from "./message-normalizer";
import { SessionGateway } from "./session-gateway";
import { readThreadRelations, writeThreadRelations } from "./thread-relations";

const THREADS_COMMAND = "threads";

type SpawnThreadInput = {
  title: string;
  prompt: string;
};

async function currentSessionContext(gateway: SessionGateway, sessionID: string): Promise<string> {
  try {
    const messages = orderedMessages(await gateway.contextMessages(sessionID, 24));
    return coordinatorContextLines(messages).join("\n");
  } catch {
    return "";
  }
}

const AgentViewPlugin: Plugin = async ({ client }) => {
  return {
    "command.execute.before": async (input, output) => {
      if (input.command !== THREADS_COMMAND) return;

      const request = input.arguments.trim();
      if (!request) return;

      const gateway = new SessionGateway(client);
      const context = await currentSessionContext(gateway, input.sessionID);

      output.parts = [
        {
          type: "text",
          text: buildCoordinatorPrompt(request, context),
        } as any,
      ];
    },

    tool: {
      spawn_threads: tool({
        description:
          "Create multiple independent user-continuable sessions for a decomposed threaded workload. The /threads UI visually nests them under the current session.",
        args: {
          threads: tool.schema.array(
            tool.schema.object({
              title: tool.schema.string().describe("Short thread title."),
              prompt: tool.schema.string().describe("Self-contained task prompt for this user-continuable session."),
            }),
          ),
        },
        async execute(args: { threads: SpawnThreadInput[] }, context) {
          const gateway = new SessionGateway(client);
          const created: Array<{ id: string; title: string }> = [];
          const relations = await readThreadRelations();

          for (const thread of args.threads) {
            const { id } = await gateway.createOrFork(thread.title, context.sessionID);
            relations[id] = context.sessionID;
            await gateway.sendPrompt(id, thread.prompt);
            created.push({ id, title: thread.title });
          }

          await writeThreadRelations(relations);

          return {
            output: created.length
              ? `Spawned ${created.length} thread(s):\n${created.map((item) => `- ${item.title}: ${item.id}`).join("\n")}`
              : "No threads were spawned.",
            metadata: { threads: created },
          };
        },
      }),
    },
  };
};

export default {
  id: "opencode.threads",
  server: AgentViewPlugin,
};
