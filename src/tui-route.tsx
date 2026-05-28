/** @jsxImportSource @opentui/solid */

import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { TuiPluginApi, TuiPromptInfo, TuiPromptRef } from "@opencode-ai/plugin/tui";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { SessionGateway } from "./session-gateway";
import { groupThreadRows, type AgentSession } from "./thread-catalog";
import { handleThreadKeyboard } from "./tui-keyboard";
import { loadSessions } from "./tui-loader";
import { padCell, rowStatusText, rowTime, rowTimeColor, rowTitle, rowTitleColor, statusColor } from "./tui-format";

const activeSessionIDs = new Set<string>();
const promptHeight = 5;

export type AgentViewRouteProps = {
  api: TuiPluginApi;
  fromSessionID?: string;
  selectedSessionID?: string;
};

export function AgentViewRoute(props: AgentViewRouteProps) {
  let scroll: ScrollBoxRenderable | undefined;
  let promptRef: TuiPromptRef | undefined;
  let newPromptRef: TuiPromptRef | undefined;
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [selectedSessionID, setSelectedSessionID] = createSignal<string | undefined>(props.selectedSessionID);
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [liveFrame, setLiveFrame] = createSignal(0);
  const [timeTick, setTimeTick] = createSignal(0);
  const [promptMode, setPromptMode] = createSignal<"reply" | "new">();
  const [submittingNew, setSubmittingNew] = createSignal(false);
  const [creatingNew, setCreatingNew] = createSignal(false);
  const [newSessionID, setNewSessionID] = createSignal<string>();
  const [optimisticSessions, setOptimisticSessions] = createSignal<AgentSession[]>([]);
  const [sessions, { refetch }] = createResource(refreshKey, () => loadSessions(props.api));
  const theme = () => props.api.theme.current;
  const visibleSessions = createMemo(() => {
    const loaded = [ ...(((sessions as any).latest ?? sessions() ?? []) as AgentSession[]) ];
    const loadedIDs = new Set(loaded.map((session) => session.id));
    return [
      ...optimisticSessions().filter((session) => !loadedIDs.has(session.id)),
      ...loaded,
    ];
  });
  const groups = createMemo(() => groupThreadRows(visibleSessions(), activeSessionIDs));
  const listRows = createMemo(() => groups().flatMap((group) => group.rows));

  const selected = createMemo(() => {
    const rows = listRows();
    const selectedID = selectedSessionID();
    if (selectedID) {
      const row = rows.find((item) => item.id === selectedID);
      if (row) return row;
    }
    return rows[Math.min(selectedIndex(), Math.max(0, rows.length - 1))];
  });

  const selectedID = createMemo(() => selected()?.id);
  const promptOpen = createMemo(() => promptMode() !== undefined);

  const refresh = () => {
    if (selected()?.id) setSelectedSessionID(selected()?.id);
    setRefreshKey((value) => value + 1);
    void refetch();
  };

  const closePrompt = () => {
    promptRef?.blur();
    promptRef?.reset();
    newPromptRef?.blur();
    newPromptRef?.reset();
    setPromptMode(undefined);
    scroll?.focus();
  };

  const cancelNewPrompt = () => {
    const sessionID = newSessionID();
    closePrompt();
    setNewSessionID(undefined);
    if (sessionID) {
      activeSessionIDs.delete(sessionID);
      setOptimisticSessions((sessions) => sessions.filter((session) => session.id !== sessionID));
      void new SessionGateway(props.api.client).delete(sessionID).finally(refresh);
    }
  };

  const replyInline = () => {
    setPromptMode("reply");
    queueMicrotask(() => promptRef?.focus());
  };

  const newAgent = async () => {
    if (creatingNew()) return;
    setCreatingNew(true);
    try {
      const { id } = await new SessionGateway(props.api.client).create("New thread");
      const now = Date.now();
      activeSessionIDs.add(id);
      setOptimisticSessions((sessions) => [
        {
          id,
          draft: true,
          title: "New thread",
          status: "idle",
          statusTone: "done",
          preview: "Start a new thread...",
          transcript: [],
          updatedAt: now,
          loadedAt: now,
          waitingCount: 0,
          depth: 0,
        },
        ...sessions.filter((session) => session.id !== id),
      ]);
      setNewSessionID(id);
      setSelectedSessionID(id);
      setSelectedIndex(0);
      setPromptMode("new");
      refresh();
      queueMicrotask(() => newPromptRef?.focus());
    } catch {
      props.api.ui.toast({ variant: "error", message: "Thread creation failed." });
    } finally {
      setCreatingNew(false);
    }
  };

  const submitNewAgent = async () => {
    if (submittingNew()) return;

    const prompt = newPromptRef?.current;
    const sessionID = newSessionID();
    if (!prompt || !sessionID) return;

    if (promptParts(prompt).length === 0) {
      props.api.ui.toast({ variant: "warning", message: "Enter a prompt to start a thread." });
      return;
    }

    setSubmittingNew(true);
    try {
      const gateway = new SessionGateway(props.api.client);
      const title = promptTitle(prompt);
      const parts = promptParts(prompt);
      await gateway.updateTitle(sessionID, title);
      setOptimisticSessions((sessions) => sessions.map((session) => (
        session.id === sessionID
          ? { ...session, draft: false, title, status: "running", statusTone: "running", preview: "Starting thread..." }
          : session
      )));
      await gateway.sendPromptParts(sessionID, parts);
      setNewSessionID(undefined);
      closePrompt();
      refresh();
    } catch {
      props.api.ui.toast({ variant: "error", message: "Thread creation failed." });
    } finally {
      setSubmittingNew(false);
    }
  };

  const abortSelected = async () => {
    const row = selected();
    if (!row) return;
    await new SessionGateway(props.api.client).abort(row.id);
    props.api.ui.toast({ variant: "warning", message: "Abort requested." });
    refresh();
  };

  const deleteSelected = async () => {
    const row = selected();
    if (!row || row.draft) return;
    props.api.ui.dialog.replace(() => (
      <props.api.ui.DialogConfirm
        title="Delete thread?"
        message={`Delete "${row.title}" permanently?`}
        onCancel={() => props.api.ui.dialog.clear()}
        onConfirm={async () => {
          props.api.ui.dialog.clear();
          await new SessionGateway(props.api.client).delete(row.id);
          activeSessionIDs.delete(row.id);
          setSelectedSessionID(undefined);
          setSelectedIndex((index) => Math.max(0, index - 1));
          props.api.ui.toast({ variant: "warning", message: "Session deleted." });
          refresh();
        }}
      />
    ));
  };

  const archiveSelected = async () => {
    const row = selected();
    if (!row || row.draft) return;

    try {
      await new SessionGateway(props.api.client).archive(row.id);
      activeSessionIDs.delete(row.id);
      setSelectedSessionID(undefined);
      setSelectedIndex((index) => Math.max(0, index - 1));
      props.api.ui.toast({ variant: "warning", message: "Session archived." });
      refresh();
    } catch {
      props.api.ui.toast({ variant: "error", message: "Session archive failed." });
    }
  };

  const attachSelected = () => {
    const row = selected();
    if (!row || row.draft) return;
    props.api.route.navigate("session", { sessionID: row.id });
  };

  const moveSelection = (delta: number) => {
    const rows = listRows();
    const currentID = selected()?.id;
    const currentIndex = currentID ? rows.findIndex((row) => row.id === currentID) : selectedIndex();
    const nextIndex = Math.min(Math.max(0, rows.length - 1), Math.max(0, currentIndex + delta));
    setSelectedSessionID(undefined);
    setSelectedIndex(nextIndex);
  };

  const goBack = () => {
    if (props.fromSessionID) props.api.route.navigate("session", { sessionID: props.fromSessionID });
    else props.api.route.navigate("home");
  };

  const onThreadKeyDown = (evt: Parameters<typeof handleThreadKeyboard>[0]) => handleThreadKeyboard(evt, {
    dialogOpen: () => props.api.ui.dialog.open,
    promptOpen,
    closePrompt: () => promptMode() === "new" ? cancelNewPrompt() : closePrompt(),
    goBack,
    moveSelection,
    attachSelected,
    newAgent: () => void newAgent(),
    replyInline,
    abortSelected: () => void abortSelected(),
    archiveSelected: () => void archiveSelected(),
    deleteSelected: () => void deleteSelected(),
  });

  onMount(() => {
    for (const row of visibleSessions()) {
      if (row.statusTone === "waiting" || row.statusTone === "running") activeSessionIDs.add(row.id);
    }

    scroll?.focus();
    const disposers = [
      props.api.keymap.intercept("key", ({ event, consume }) => {
        if (promptMode() === "new" && event.name === "return" && !event.ctrl && !event.meta && !event.super) {
          consume();
          void submitNewAgent();
          return;
        }

        onThreadKeyDown({
          defaultPrevented: false,
          name: event.name,
          ctrl: event.ctrl,
          meta: event.meta,
          super: event.super,
          preventDefault: consume,
          stopPropagation: () => {},
        });
      }),
      props.api.event.on("session.created", (event: any) => {
        const sessionID = event.properties?.info?.id ?? event.properties?.sessionID ?? event.properties?.id;
        if (typeof sessionID === "string") {
          activeSessionIDs.add(sessionID);
        }
        refresh();
      }),
      props.api.event.on("session.updated", refresh),
      props.api.event.on("session.status", (event: any) => {
        const sessionID = event.properties?.sessionID ?? event.properties?.id;
        if (typeof sessionID === "string") activeSessionIDs.add(sessionID);
        refresh();
      }),
      props.api.event.on("message.updated", refresh),
      props.api.event.on("permission.asked", refresh),
      props.api.event.on("permission.replied", refresh),
    ];
    const listTimer = setInterval(refresh, 6000);
    const liveTimer = setInterval(() => setLiveFrame((frame) => frame + 1), 90);
    const timeTimer = setInterval(() => setTimeTick((tick) => tick + 1), 1000);
    disposers.push(
      () => clearInterval(listTimer),
      () => clearInterval(liveTimer),
      () => clearInterval(timeTimer),
    );
    onCleanup(() => disposers.forEach((dispose) => dispose()));
  });

  createEffect(() => {
    const row = selected();
    const index = row ? listRows().findIndex((item) => item.id === row.id) : -1;
    if (index >= 0 && index !== selectedIndex()) setSelectedIndex(index);
    if (row) scroll?.scrollChildIntoView(`thread-row-${row.id}`);
  });

  createEffect(() => {
    selectedID();
    if (untrack(promptMode) === "new") return;
    promptRef?.blur();
    promptRef?.reset();
    newPromptRef?.blur();
    newPromptRef?.reset();
    setPromptMode(undefined);
  });

  createEffect(() => {
    const loaded = (((sessions as any).latest ?? sessions() ?? []) as AgentSession[]);
    if (loaded.length === 0) return;
    const loadedIDs = new Set(loaded.map((session) => session.id));
    setOptimisticSessions((sessions) => sessions.filter((session) => !loadedIDs.has(session.id)));
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme().background}>
      <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="row" gap={3}>
        <box flexDirection="row" gap={2}>
          <text fg={theme().textMuted}>j/k move</text>
          <text fg={theme().accent}>n new</text>
          <text fg={theme().accent}>r reply</text>
          <text fg={theme().textMuted}>enter attach</text>
          <text fg={theme().textMuted}>delete remove</text>
          <text fg={theme().textMuted}>esc back</text>
        </box>
      </box>

      <box flexDirection="column" flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} gap={0}>
        <box flexDirection="column" height={0} flexGrow={1} minHeight={0}>
          <scrollbox
            ref={(renderable: ScrollBoxRenderable) => (scroll = renderable)}
            minHeight={0}
            flexGrow={1}
            focusable
            onKeyDown={onThreadKeyDown}
            scrollbarOptions={{ visible: false }}
          >
            <box flexDirection="column" width="100%">
              <Show when={!sessions.loading || visibleSessions().length > 0} fallback={<text fg={theme().textMuted}>Loading sessions...</text>}>
                <For each={groups()} fallback={<text fg={theme().textMuted}>No sessions yet. Press n to start one.</text>}>
                  {(group) => (
                    <box flexDirection="column" paddingTop={1}>
                      <box flexDirection="row" gap={1}>
                        <text fg={theme().textMuted} attributes={TextAttributes.BOLD}>{group.title}</text>
                      </box>
                      <For each={group.rows}>
                        {(row) => {
                          const globalIndex = () => listRows().findIndex((item) => item.id === row.id);
                          const selectedRow = () => selected()?.id === row.id;
                          return (
                            <box
                              id={`thread-row-${row.id}`}
                              flexDirection="row"
                              width="100%"
                              gap={3}
                              paddingLeft={1}
                              paddingRight={1}
                              backgroundColor={selectedRow() ? theme().backgroundElement : undefined}
                            >
                              <text
                                fg={statusColor(theme(), row.statusTone)}
                                attributes={selectedRow() ? TextAttributes.BOLD : undefined}
                                wrapMode="none"
                              >
                                {padCell(rowStatusText(row, liveFrame(), globalIndex()), 3)}
                              </text>
                              <text
                                fg={rowTitleColor(theme(), row, selectedRow())}
                                wrapMode="none"
                                flexGrow={1}
                                minWidth={0}
                                truncate
                              >
                                {rowTitle(row)}
                              </text>
                              <text fg={rowTimeColor(theme(), selectedRow())} wrapMode="none">
                                {rowTime(row, timeTick())}
                              </text>
                            </box>
                          );
                        }}
                      </For>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </scrollbox>
        </box>

        <box
          flexDirection="column"
          height={0}
          flexGrow={2}
          flexShrink={1}
          minHeight={0}
          border={["top"]}
          borderColor={theme().borderSubtle}
          paddingLeft={1}
          paddingRight={1}
          overflow="hidden"
        >
          <Show when={selected()} keyed fallback={<text fg={theme().textMuted}>Select a session to preview its thread.</text>}>
            {(row) => (
              <box flexDirection="column" flexGrow={1} minHeight={0}>
                <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1} overflow="hidden" justifyContent="flex-end">
                  <For each={(row.transcript.length > 0 ? row.transcript : [{ role: "assistant" as const, text: row.preview }]).slice(-5)}>
                    {(turn, index) => (
                      <Show
                        when={turn.role === "user"}
                        fallback={(
                          <box flexDirection="column" marginTop={index() === 0 ? 0 : 1} paddingLeft={turn.role === "assistant" ? 3 : 0}>
                            <text fg={turn.role === "activity" ? theme().textMuted : theme().text} wrapMode="word">{turn.text}</text>
                            <Show when={turn.role === "assistant" && (turn.mode || turn.model)}>
                              <text marginTop={1} fg={theme().textMuted} wrapMode="none">
                                <span style={{ fg: statusColor(theme(), row.statusTone) }}>▣ </span>
                                <span style={{ fg: theme().text }}>{turn.mode ?? "agent"}</span>
                                <Show when={turn.model}>
                                  <span style={{ fg: theme().textMuted }}> · {turn.model}</span>
                                </Show>
                              </text>
                            </Show>
                          </box>
                        )}
                      >
                        <box
                          border={["left"]}
                          borderColor={theme().accent}
                          paddingTop={1}
                          paddingBottom={1}
                          paddingLeft={2}
                          marginTop={index() === 0 ? 0 : 1}
                          backgroundColor={theme().backgroundElement}
                        >
                          <text fg={theme().text} wrapMode="word">{turn.text}</text>
                        </box>
                      </Show>
                    )}
                  </For>
                </box>
              </box>
            )}
          </Show>
        </box>

        <box
          flexDirection="column"
          flexShrink={0}
          border={["top"]}
          borderColor={theme().borderSubtle}
          paddingTop={1}
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={1}
        >
          <Show
            when={promptMode() === "new"}
            fallback={(
              <Show when={selected()} keyed fallback={<text fg={theme().textMuted}>Select a session.</text>}>
                {(row) => (
                  <box flexDirection="column">
                    <box paddingTop={0} flexDirection="column" gap={0} flexGrow={1} minHeight={0}>
                      <Show
                        when={promptMode() === "reply"}
                        fallback={(
                          <box
                            flexDirection="column"
                            height={promptHeight}
                            maxHeight={promptHeight}
                            paddingLeft={2}
                            paddingTop={1}
                            backgroundColor={theme().backgroundElement}
                          >
                            <text fg={theme().textMuted} wrapMode="none">
                              Reply to this thread...
                            </text>
                          </box>
                        )}
                      >
                        <props.api.ui.Prompt
                          sessionID={row.id}
                          visible
                          ref={(ref) => {
                            promptRef = ref;
                            if (ref && promptMode() === "reply") ref.focus();
                          }}
                          onSubmit={() => {
                            promptRef?.blur();
                            setPromptMode(undefined);
                            scroll?.focus();
                            refresh();
                          }}
                          showPlaceholder
                          placeholders={{ normal: ["Reply to this thread..."] }}
                        />
                      </Show>
                    </box>
                  </box>
                )}
              </Show>
            )}
          >
            <box flexDirection="column">
              <box flexDirection="row" gap={2}>
                <text fg={theme().text} attributes={TextAttributes.BOLD}>New thread</text>
                <text fg={theme().textMuted}>enter start</text>
                <text fg={theme().textMuted}>esc cancel</text>
              </box>

              <box paddingTop={0} flexDirection="column" gap={0} flexGrow={1} minHeight={0}>
                <props.api.ui.Prompt
                  sessionID={newSessionID()}
                  visible
                  ref={(ref) => (newPromptRef = ref)}
                  onSubmit={() => {
                    closePrompt();
                    refresh();
                  }}
                  showPlaceholder
                  placeholders={{ normal: ["Start a new thread..."] }}
                />
              </box>
            </box>
          </Show>
        </box>
      </box>
    </box>
  );
}

function promptParts(prompt: TuiPromptInfo) {
  const text = prompt.input.trim();
  if (prompt.parts.length > 0) {
    const parts: TuiPromptInfo["parts"] = [];
    const appendText = (value: string) => {
      if (!value) return;
      const last = parts.at(-1);
      if (last?.type === "text") last.text += value;
      else parts.push({ type: "text", text: value });
    };
    let partIndex = 0;
    let lastIndex = 0;

    for (const match of text.matchAll(/\[Pasted [^\]]+\]/g)) {
      const start = match.index ?? 0;
      appendText(text.slice(lastIndex, start));

      const part = prompt.parts[partIndex++];
      if (part?.type === "text") appendText(part.text);
      else if (part) parts.push(part);

      lastIndex = start + match[0].length;
    }

    appendText(text.slice(lastIndex));

    return partIndex > 0 ? parts : prompt.parts;
  }

  return text ? [{ type: "text" as const, text }] : [];
}

function promptTitle(prompt: TuiPromptInfo) {
  const text = promptParts(prompt)
    .map((part) => part.type === "text" ? part.text : "")
    .join(" ")
    .trim() || prompt.input.trim();

  return text.split("\n", 1)[0]?.trim() || "New thread";
}
