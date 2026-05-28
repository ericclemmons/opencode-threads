import { describe, expect, test } from "bun:test";
import { SessionGateway } from "../src/session-gateway";

describe("SessionGateway", () => {
  test("updates titles using the v2 sessionID path after legacy update errors", async () => {
    const payloads: unknown[] = [];
    const gateway = new SessionGateway({
      update: async (payload: unknown) => {
        payloads.push(payload);
        if ((payload as any).path?.sessionID) return { id: "session-1", title: "Fixed title" };
        return { error: { message: "missing path.sessionID" } };
      },
    });

    await gateway.updateTitle("session-1", "Fixed title");

    expect(payloads).toEqual([
      { path: { id: "session-1" }, body: { title: "Fixed title" } },
      { path: { sessionID: "session-1" }, body: { title: "Fixed title" } },
    ]);
  });
});
