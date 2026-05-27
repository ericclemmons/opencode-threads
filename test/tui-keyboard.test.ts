import { describe, expect, test } from "bun:test";
import { handleThreadKeyboard, type ThreadKeyboardHandlers } from "../src/tui-keyboard";

function handlers(overrides: Partial<ThreadKeyboardHandlers> = {}) {
  const calls: string[] = [];
  const base: ThreadKeyboardHandlers = {
    dialogOpen: () => false,
    promptOpen: () => false,
    closePrompt: () => calls.push("closePrompt"),
    goBack: () => calls.push("goBack"),
    moveSelection: (delta) => calls.push(`moveSelection:${delta}`),
    attachSelected: () => calls.push("attachSelected"),
    newAgent: () => calls.push("newAgent"),
    replyInline: () => calls.push("replyInline"),
    abortSelected: () => calls.push("abortSelected"),
    archiveSelected: () => calls.push("archiveSelected"),
    deleteSelected: () => calls.push("deleteSelected"),
    ...overrides,
  };
  return { calls, handlers: base };
}

function press(name: string, options: Partial<{ ctrl: boolean; meta: boolean; super: boolean }> = {}) {
  const calls: string[] = [];
  return {
    event: {
      name,
      ...options,
      preventDefault: () => calls.push("preventDefault"),
      stopPropagation: () => calls.push("stopPropagation"),
    },
    calls,
  };
}

describe("handleThreadKeyboard", () => {
  test("maps navigation and attach keys", () => {
    const state = handlers();

    for (const key of ["j", "down", "k", "up", "return"]) {
      handleThreadKeyboard(press(key).event, state.handlers);
    }

    expect(state.calls).toEqual([
      "moveSelection:1",
      "moveSelection:1",
      "moveSelection:-1",
      "moveSelection:-1",
      "attachSelected",
    ]);
  });

  test("escape closes the prompt before navigating back", () => {
    const open = handlers({ promptOpen: () => true });
    handleThreadKeyboard(press("escape").event, open.handlers);
    expect(open.calls).toEqual(["closePrompt"]);

    const closed = handlers();
    handleThreadKeyboard(press("escape").event, closed.handlers);
    expect(closed.calls).toEqual(["goBack"]);
  });

  test("delete removes and command delete archives", () => {
    const state = handlers();

    handleThreadKeyboard(press("delete").event, state.handlers);
    handleThreadKeyboard(press("delete", { meta: true }).event, state.handlers);

    expect(state.calls).toEqual(["deleteSelected", "archiveSelected"]);
  });

  test("r opens reply mode", () => {
    const state = handlers();

    handleThreadKeyboard(press("r").event, state.handlers);

    expect(state.calls).toEqual(["replyInline"]);
  });

  test("ignores ordinary shortcuts while a dialog or prompt is open", () => {
    const dialog = handlers({ dialogOpen: () => true });
    handleThreadKeyboard(press("j").event, dialog.handlers);

    const prompt = handlers({ promptOpen: () => true });
    handleThreadKeyboard(press("j").event, prompt.handlers);

    expect(dialog.calls).toEqual([]);
    expect(prompt.calls).toEqual([]);
  });
});
