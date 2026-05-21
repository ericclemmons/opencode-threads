import { describe, expect, test } from "bun:test";
import { buildThreadRows, flattenNestedThreadRows, groupThreadRows, type AgentSession } from "../src/thread-catalog";

const loadedAt = Date.parse("2026-05-20T12:00:00Z");

function row(input: Partial<AgentSession> & Pick<AgentSession, "id" | "title" | "updatedAt">): AgentSession {
  return {
    status: "idle",
    statusTone: "done",
    preview: "",
    transcript: [],
    loadedAt,
    waitingCount: 0,
    depth: 0,
    ...input,
  };
}

describe("thread catalog", () => {
  test("buildThreadRows filters archived and hidden subagent sessions", async () => {
    const rows = await buildThreadRows({
      loadedAt,
      relations: { child: "parent" },
      statusMap: { child: { status: "running" }, waiting: { status: "idle" } },
      rawSessions: [
        { id: "parent", title: "Parent", time: { updated: loadedAt - 1000 } },
        { id: "child", title: "Child", time: { updated: loadedAt } },
        { id: "archived", title: "Archived", time: { archived: loadedAt, updated: loadedAt } },
        { id: "subagent", parentID: "parent", title: "Run checks (@test subagent)", time: { updated: loadedAt } },
        { id: "waiting", title: "Waiting", time: { updated: loadedAt - 2000 } },
      ],
      getWaitingCount: (sessionID) => (sessionID === "waiting" ? 2 : 0),
      loadTranscript: async (sessionID) => ({ preview: `preview:${sessionID}`, transcript: [] }),
    });

    expect(rows.map((item) => item.id)).toEqual(["parent", "child", "waiting"]);
    expect(rows.find((item) => item.id === "child")?.depth).toBe(1);
    expect(rows.find((item) => item.id === "child")?.statusTone).toBe("running");
    expect(rows.find((item) => item.id === "waiting")?.statusTone).toBe("waiting");
  });

  test("flattenNestedThreadRows sorts roots and nests children below parents", () => {
    const flattened = flattenNestedThreadRows([
      row({ id: "child-old", parentID: "parent", title: "Child old", updatedAt: loadedAt - 100 }),
      row({ id: "new-root", title: "New root", updatedAt: loadedAt + 100 }),
      row({ id: "parent", title: "Parent", updatedAt: loadedAt }),
      row({ id: "child-new", parentID: "parent", title: "Child new", updatedAt: loadedAt + 50 }),
    ]);

    expect(flattened.map((item) => `${item.id}:${item.depth}`)).toEqual([
      "new-root:0",
      "parent:0",
      "child-new:1",
      "child-old:1",
    ]);
  });

  test("groupThreadRows keeps active child sessions with today's roots", () => {
    const groups = groupThreadRows([
      row({ id: "parent", title: "Parent", updatedAt: Date.parse("2026-05-01T12:00:00Z") }),
      row({ id: "child", parentID: "parent", title: "Child", updatedAt: Date.parse("2026-05-01T13:00:00Z"), statusTone: "running" }),
    ], new Set(), new Date("2026-05-20T12:00:00Z"));

    expect(groups[0]).toEqual({
      title: "Today",
      rows: expect.arrayContaining([
        expect.objectContaining({ id: "parent" }),
        expect.objectContaining({ id: "child" }),
      ]),
    });
  });
});
