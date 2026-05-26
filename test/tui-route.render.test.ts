import { describe, expect, test } from "bun:test";

const theme = {
  accent: "#9cdcfe",
  background: "#000000",
  backgroundElement: "#222222",
  borderSubtle: "#333333",
  error: "#f48771",
  info: "#4fc1ff",
  text: "#ffffff",
  textMuted: "#888888",
  warning: "#ffcc66",
};

function api() {
  const navigations: Array<[string, unknown]> = [];
  const listeners: string[] = [];
  const listenerHandlers: Record<string, (event: any) => void> = {};
  const promptRefs: Array<{ resets: number }> = [];
  let keyHandler: ((input: any) => void) | undefined;

  return {
    api: {
      theme: { current: theme },
      client: {
        session: {
          list: async () => [
            { id: "parent", title: "Parent thread", time: { updated: Date.parse("2026-05-20T12:00:00Z") } },
            { id: "child", parentID: "parent", title: "Child thread", time: { updated: Date.parse("2026-05-20T12:01:00Z") } },
          ],
          status: async () => ({ child: { status: "running" } }),
          messages: async ({ sessionID }: { sessionID: string }) => ({
            items: [
              { role: "assistant", content: [{ type: "text", text: `Preview for ${sessionID}` }], time: { created: Date.parse("2026-05-20T12:02:00Z") } },
            ],
          }),
        },
      },
      event: {
        on: (name: string, handler: (event: any) => void) => {
          listeners.push(name);
          listenerHandlers[name] = handler;
          return () => {};
        },
      },
      keymap: {
        intercept: (_type: string, handler: (input: any) => void) => {
          keyHandler = handler;
          return () => {};
        },
      },
      route: {
        navigate: (name: string, params?: unknown) => navigations.push([name, params]),
      },
      state: {
        session: {
          permission: () => [],
          question: () => [],
        },
      },
      ui: {
        dialog: {
          get open() {
            return false;
          },
          clear: () => {},
          replace: () => {},
        },
        DialogConfirm: () => undefined,
        Prompt: (props: any) => {
          const ref = {
            focused: false,
            current: { input: "[Pasted ~4 lines] ", parts: [] },
            resets: 0,
            set: () => {},
            reset: () => ref.resets++,
            blur: () => {},
            focus: () => {},
            submit: () => {},
          };
          promptRefs.push(ref);
          props.ref?.(ref);
          return undefined;
        },
        toast: () => {},
      },
    } as any,
    emit: (name: string, event: any) => listenerHandlers[name]?.(event),
    key: (name: string) => keyHandler?.({
      event: { name, ctrl: false, meta: false, super: false },
      consume: () => {},
    }),
    listeners,
    navigations,
    promptRefs,
  };
}

async function settle(renderOnce: () => Promise<void>) {
  await Bun.sleep(0);
  await renderOnce();
}

describe("AgentViewRoute rendered output", () => {
  test("renders session rows and selected thread preview", async () => {
    const { createComponent, testRender } = await import("@opentui/solid");
    const { AgentViewRoute } = await import("../src/tui-route");
    const setupApi = api();
    const setup = await testRender(() => createComponent(AgentViewRoute, { api: setupApi.api }), { width: 100, height: 24 });

    try {
      await settle(setup.renderOnce);
      const frame = setup.captureCharFrame();

      expect(frame).toContain("j/k move");
      expect(frame).toContain("Today");
      expect(frame).toContain("Parent thread");
      expect(frame).toContain("Child thread");
      expect(frame).toContain("Preview for parent");
      expect(frame).toContain("Reply to this thread");
      expect(setupApi.listeners).toContain("session.created");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("returns to threads after new prompt session activation", async () => {
    const { createComponent, testRender } = await import("@opentui/solid");
    const { AgentViewRoute } = await import("../src/tui-route");
    const setupApi = api();
    const setup = await testRender(() => createComponent(AgentViewRoute, { api: setupApi.api }), { width: 100, height: 24 });

    try {
      await settle(setup.renderOnce);
      setupApi.key("n");
      setupApi.emit("session.created", { properties: { info: { id: "new-thread" } } });

      setTimeout(() => setupApi.api.route.navigate("session", { sessionID: "new-thread" }), 0);
      await Bun.sleep(30);

      expect(setupApi.navigations.at(-1)).toEqual(["threads", { selectedSessionID: "new-thread" }]);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("does not reset the new prompt synchronously on session creation", async () => {
    const { createComponent, testRender } = await import("@opentui/solid");
    const { AgentViewRoute } = await import("../src/tui-route");
    const setupApi = api();
    const setup = await testRender(() => createComponent(AgentViewRoute, { api: setupApi.api }), { width: 100, height: 24 });

    try {
      await settle(setup.renderOnce);
      setupApi.key("n");
      await settle(setup.renderOnce);
      const promptRef = setupApi.promptRefs.at(-1);

      setupApi.emit("session.created", { properties: { info: { id: "new-thread" } } });
      await setup.renderOnce();

      expect(promptRef?.resets).toBe(0);
    } finally {
      setup.renderer.destroy();
    }
  });
});
