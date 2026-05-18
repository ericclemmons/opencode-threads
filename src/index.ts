import { tool, type Plugin } from "@opencode-ai/plugin";
import { buildCoordinatorPrompt } from "./coordinator-prompt";
import { readThreadRelations, writeThreadRelations } from "./thread-relations";

const THREADS_COMMAND = "threads";

type SpawnThreadInput = {
  title: string;
  prompt: string;
};

function unwrap<T>(result: T | { data?: T }): T {
  if (result && typeof result === "object" && "data" in result) return (result as { data?: T }).data as T;
  return result as T;
}

function compactText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").trim();
}

function partText(part: any): string {
  if (!part || typeof part !== "object") return "";
  const type = typeof part.type === "string" ? part.type : "";
  if (type && /^(step-|reasoning|tool|agent-|model-|session-|message-|part-)/i.test(type)) return "";
  return compactText(part.text ?? part.content ?? part.summary);
}

function messageText(message: any): string {
  const parts = Array.isArray(message?.content)
    ? message.content
    : Array.isArray(message?.parts)
      ? message.parts
      : Array.isArray(message?.info?.parts)
        ? message.info.parts
        : [];
  const fromParts = compactText(parts.map(partText).filter(Boolean).join(" "));
  if (fromParts) return fromParts;
  return compactText(message?.info?.text ?? message?.text ?? message?.content ?? message?.summary);
}

function messageSpeaker(message: any): string {
  const role = message?.info?.role ?? message?.role ?? message?.type;
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  return "Note";
}

async function currentSessionContext(sessionApi: any, sessionID: string): Promise<string> {
  try {
    let result: unknown;
    try {
      result = await sessionApi.messages?.({ path: { id: sessionID }, query: { limit: 24 } });
    } catch {
      result = await sessionApi.messages?.({ sessionID, limit: 24 });
    }
    const payload = unwrap<any[] | { items?: any[] }>(result as any);
    const messages = Array.isArray(payload) ? payload : payload?.items ?? [];
    return messages
      .map((message) => {
        const text = messageText(message);
        return text ? `${messageSpeaker(message)}: ${text}` : "";
      })
      .filter(Boolean)
      .slice(-12)
      .join("\n");
  } catch {
    return "";
  }
}

function sessionID(session: any): string | undefined {
  const id = session?.id ?? session?.data?.id;
  return typeof id === "string" && id ? id : undefined;
}

async function updateThreadTitle(sessionApi: any, sessionID: string, title: string) {
  const safeTitle = title.slice(0, 120);

  try {
    await sessionApi.update?.({ path: { id: sessionID }, body: { title: safeTitle } });
  } catch {
    await sessionApi.update?.({ sessionID, title: safeTitle });
  }
}

async function createThreadSession(sessionApi: any, title: string, sourceSessionID: string) {
  const safeTitle = title.slice(0, 120);

  if (typeof sessionApi.fork === "function") {
    for (const payload of [
      { path: { id: sourceSessionID }, body: {} },
      { path: { sessionID: sourceSessionID }, body: {} },
      { sessionID: sourceSessionID },
    ]) {
      try {
        const session = unwrap<any>(await sessionApi.fork(payload));
        const id = sessionID(session);
        if (!id) continue;
        await updateThreadTitle(sessionApi, id, safeTitle);
        return session;
      } catch {
        // Try the next SDK shape before falling back to creating a fresh root session.
      }
    }
  }

  try {
    return unwrap<any>(await sessionApi.create({ body: { title: safeTitle } }));
  } catch {
    return unwrap<any>(await sessionApi.create({ title: safeTitle }));
  }
}

async function sendPrompt(sessionApi: any, sessionID: string, prompt: string) {
  const body = {
    parts: [{ type: "text", text: prompt }],
  };
  const legacyPayload = {
    path: { id: sessionID },
    body,
  };
  const flatPayload = {
    sessionID,
    ...body,
  };

  if (typeof sessionApi.promptAsync === "function") {
    try {
      await sessionApi.promptAsync(legacyPayload);
    } catch {
      await sessionApi.promptAsync(flatPayload);
    }
    return;
  }

  if (typeof sessionApi.prompt_async === "function") {
    try {
      await sessionApi.prompt_async(legacyPayload);
    } catch {
      await sessionApi.prompt_async(flatPayload);
    }
    return;
  }

  try {
    await sessionApi.prompt(legacyPayload);
  } catch {
    await sessionApi.prompt(flatPayload);
  }
}

const AgentViewPlugin: Plugin = async ({ client }) => {
  return {
    "command.execute.before": async (input, output) => {
      if (input.command !== THREADS_COMMAND) return;

      const request = input.arguments.trim();
      if (!request) return;

      const sessionApi = (client as any).session;
      const context = await currentSessionContext(sessionApi, input.sessionID);

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
          const sessionApi = (client as any).session;
          const created: Array<{ id: string; title: string }> = [];
          const relations = await readThreadRelations();

          for (const thread of args.threads) {
            const session = await createThreadSession(sessionApi, thread.title, context.sessionID);
            const id = sessionID(session);
            if (!id) throw new Error(`Failed to create thread session for ${thread.title}`);
            relations[id] = context.sessionID;
            await sendPrompt(sessionApi, id, thread.prompt);
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
