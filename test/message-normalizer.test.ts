import { describe, expect, test } from "bun:test";
import { coordinatorContextLines, latestTurnText, orderedMessages, sessionTranscript } from "../src/message-normalizer";

describe("message normalizer", () => {
  test("orders messages by mixed timestamp shapes", () => {
    const messages = [
      { id: "third", createdAt: "2026-05-20T12:02:00Z" },
      { id: "first", time: { created: Date.parse("2026-05-20T12:00:00Z") } },
      { id: "second", info: { time: { created: "2026-05-20T12:01:00Z" } } },
    ];

    expect(orderedMessages(messages).map((message) => message.id)).toEqual(["first", "second", "third"]);
  });

  test("extracts context lines while dropping lifecycle noise", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "  Please   test this  " }] },
      { type: "step-start", text: "internal" },
      { role: "assistant", parts: [{ type: "reasoning-detail", text: "hidden" }, { type: "text", text: "Done" }] },
    ];

    expect(coordinatorContextLines(messages)).toEqual(["User: Please test this", "Assistant: Done"]);
  });

  test("uses tool activity in transcripts and skips it in coordinator context", () => {
    const messages = [
      { role: "assistant", parts: [{ type: "tool", tool: "bash", state: { status: "running" } }] },
    ];

    expect(sessionTranscript(messages)).toEqual([{ speaker: "Agent", text: "Running command" }]);
    expect(coordinatorContextLines(messages)).toEqual([]);
  });

  test("returns latest visible turn text", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "Older" }] },
      { role: "user", content: [{ type: "text", text: "Latest **question**" }] },
    ];

    expect(latestTurnText(messages)).toBe("👤 Latest question");
  });
});
