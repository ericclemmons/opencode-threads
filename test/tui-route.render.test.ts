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

function api(options: { sessions?: any[]; blockRefresh?: boolean; deferPromptRefs?: boolean } = {}) {
  const navigations: Array<[string, unknown]> = [];
  const listeners: string[] = [];
  const createdTitles: string[] = [];
  const updatedTitles: string[] = [];
  const promptCalls: unknown[] = [];
  const listenerHandlers: Record<string, (event: any) => void> = {};
  const promptRefs: Array<{ current: { input: string; parts: any[] }; focused: boolean; resets: number }> = [];
  const pendingPromptRefs: Array<() => void> = [];
  let keyHandler: ((input: any) => void) | undefined;
  let listCalls = 0;
  const sessions = options.sessions ?? [
    { id: "parent", title: "Parent thread", time: { updated: Date.parse("2026-05-20T12:00:00Z") } },
    { id: "child", parentID: "parent", title: "Child thread", time: { updated: Date.parse("2026-05-20T12:01:00Z") } },
  ];

  return {
    api: {
      theme: { current: theme },
      client: {
        session: {
          list: async () => {
            listCalls++;
            if (options.blockRefresh && listCalls > 1) await new Promise(() => {});
            return sessions;
          },
          create: async ({ body }: { body: { title: string } }) => {
            createdTitles.push(body.title);
            return { id: "new-thread", title: body.title, time: { updated: Date.parse("2026-05-20T12:03:00Z") } };
          },
          update: async ({ body }: { body: { title: string } }) => {
            updatedTitles.push(body.title);
            return { id: "new-thread", title: body.title, time: { updated: Date.parse("2026-05-20T12:03:00Z") } };
          },
          delete: async () => {},
          promptAsync: async (payload: unknown) => {
            promptCalls.push(payload);
          },
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
            current: { input: "New thread body", parts: [] },
            resets: 0,
            set: () => {},
            reset: () => ref.resets++,
            blur: () => {
              ref.focused = false;
            },
            focus: () => {
              ref.focused = true;
            },
            submit: () => {
              if (props.sessionID) {
                promptCalls.push({ sessionID: props.sessionID, parts: ref.current.parts });
              }
              props.onSubmit?.();
              if (!props.sessionID) navigations.push(["session", { sessionID: "native-new-thread" }]);
            },
          };
          promptRefs.push(ref);
          const setRef = () => props.ref?.(ref);
          if (options.deferPromptRefs) pendingPromptRefs.push(setRef);
          else setRef();
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
    flushPromptRefs: () => pendingPromptRefs.splice(0).forEach((setRef) => setRef()),
    listeners,
    navigations,
    createdTitles,
    updatedTitles,
    promptCalls,
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
    const setup = await testRender(() => createComponent(AgentViewRoute, { api: setupApi.api }), { width: 100, height: 30 });

    try {
      await settle(setup.renderOnce);
      const frame = setup.captureCharFrame();

      expect(frame).toContain("j/k move");
      expect(frame).toContain("Today");
      expect(frame).toContain("Parent thread");
      expect(frame).toContain("Child thread");
      expect(frame).toContain("Preview for parent");
      expect(frame.split("\n").find((line) => line.includes("Parent thread"))).not.toContain("Preview for parent");
      expect(frame).toContain("Reply to this thread");
      expect(setupApi.listeners).toContain("session.created");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("lets thread titles use the available row width", async () => {
    const { createComponent, testRender } = await import("@opentui/solid");
    const { AgentViewRoute } = await import("../src/tui-route");
    const setupApi = api({
      sessions: [
        {
          id: "long-title",
          title: "This title should keep using all the available horizontal row space before time",
          time: { updated: Date.parse("2026-05-20T12:00:00Z") },
        },
      ],
    });
    const setup = await testRender(() => createComponent(AgentViewRoute, { api: setupApi.api }), { width: 90, height: 24 });

    try {
      await settle(setup.renderOnce);
      const row = setup.captureCharFrame().split("\n").find((line) => line.includes("This title should"));

      expect(row).toContain("horizontal row space");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("opens the native prompt when replying to a selected thread", async () => {
    const { createComponent, testRender } = await import("@opentui/solid");
    const { AgentViewRoute } = await import("../src/tui-route");
    const setupApi = api();
    const setup = await testRender(() => createComponent(AgentViewRoute, { api: setupApi.api }), { width: 100, height: 24 });

    try {
      await settle(setup.renderOnce);
      setupApi.key("r");
      await settle(setup.renderOnce);

      expect(setupApi.promptRefs.at(-1)?.focused).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("focuses the reply prompt when its ref is provided after opening", async () => {
    const { createComponent, testRender } = await import("@opentui/solid");
    const { AgentViewRoute } = await import("../src/tui-route");
    const setupApi = api({ deferPromptRefs: true });
    const setup = await testRender(() => createComponent(AgentViewRoute, { api: setupApi.api }), { width: 100, height: 24 });

    try {
      await settle(setup.renderOnce);
      setupApi.key("r");
      await settle(setup.renderOnce);
      setupApi.flushPromptRefs();

      expect(setupApi.promptRefs.at(-1)?.focused).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("creates a new thread with pasted and typed prompt text", async () => {
    const { createComponent, testRender } = await import("@opentui/solid");
    const { AgentViewRoute } = await import("../src/tui-route");
    const setupApi = api();
    const setup = await testRender(() => createComponent(AgentViewRoute, { api: setupApi.api }), { width: 100, height: 24 });

    try {
      await settle(setup.renderOnce);
      setupApi.key("n");
      await settle(setup.renderOnce);

      const promptRef = setupApi.promptRefs.at(-1);
      if (promptRef) {
        promptRef.current = {
          input: "Summarize [Pasted ~4 lines] then follow up",
          parts: [{ type: "text", text: "Pasted line 1\nPasted line 2" }],
        };
      }
      setupApi.key("return");
      await settle(setup.renderOnce);

      expect(setupApi.createdTitles).toEqual(["New thread"]);
      expect(setupApi.updatedTitles).toEqual(["Summarize Pasted line 1"]);
      expect(setupApi.promptCalls).toEqual([
        { path: { id: "new-thread" }, body: { parts: [{ type: "text", text: "Summarize Pasted line 1\nPasted line 2 then follow up" }] } },
      ]);
      expect(setupApi.navigations).toEqual([]);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("keeps a new thread visible while the session refresh is pending", async () => {
    const { createComponent, testRender } = await import("@opentui/solid");
    const { AgentViewRoute } = await import("../src/tui-route");
    const setupApi = api({ sessions: [], blockRefresh: true });
    const setup = await testRender(() => createComponent(AgentViewRoute, { api: setupApi.api }), { width: 100, height: 24 });

    try {
      await settle(setup.renderOnce);
      setupApi.key("n");
      await settle(setup.renderOnce);
      const frame = setup.captureCharFrame();

      expect(frame).toContain("New thread");
      expect(frame).toContain("Start a new thread");
      expect(frame.split("\n").find((line) => line.includes("New thread") && line.includes("now"))).not.toContain("Start a new thread");
      expect(frame).not.toContain("Loading sessions");
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
