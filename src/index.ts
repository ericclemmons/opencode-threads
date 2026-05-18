import { tool, type Plugin } from "@opencode-ai/plugin";
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

function coordinatorPrompt(request: string, context: string) {
  return `You are the /threads coordinator.

User request:
${request}

Current session context:
${context || "No prior session context was available."}

Rule:
/threads means: identify N concrete items, then create N user-continuable sessions, one per item.

Mandatory behavior:
- If N > 1, you MUST call spawn_threads exactly once before your final answer.
- If N > 1, answering inline without calling spawn_threads is incorrect.
- If the user asks for a numbered set like "top 3", "5 issues", or "two words", N is that requested count unless discovery finds fewer real items.
- The coordinator may do discovery, filtering, ranking, and item selection, but it must not complete the per-item work inline when N > 1.
- Your final answer after spawning should be brief: say how many sessions were created and list their titles. Do not include the full per-item results.

Process:
1. Determine the item list first. Use current session context when the user says things like "these", "them", "the issues", "the words", or "the top 3 stories".
2. If the item list is not already known, do only enough discovery in this coordinator session to identify the N items.
3. When N > 1, call spawn_threads exactly once with one thread per item.
4. Each thread title must name the single item.
5. Each thread prompt must be singular and self-contained. It should tell that new session to do the requested work for exactly one item, with any URL/title/context needed.
6. Do not do the per-item work in this coordinator when N > 1. The spawned sessions do that work.
7. If N is 0, report that no items were found and do not spawn.

Examples:
- User: "/threads summarize the top 3 tech stories today"
  Coordinator: find the top 3 tech stories, then spawn 3 sessions:
  1. "Summarize <story 1 title>" with that story's URL/context.
  2. "Summarize <story 2 title>" with that story's URL/context.
  3. "Summarize <story 3 title>" with that story's URL/context.
  Do not summarize the 3 stories inline.
- User: "/threads define these words" after prior context says "lunar velvet"
  Coordinator: spawn 2 sessions: "Define lunar" and "Define velvet".
- User: "/threads fix these" after prior context lists 5 GitHub issues
  Coordinator: spawn 5 sessions, one prompt per issue URL.

Use spawn_threads. Do not run opencode manually.`;
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
          text: coordinatorPrompt(request, context),
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
