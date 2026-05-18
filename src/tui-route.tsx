/** @jsxImportSource @opentui/solid */

import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui";
import { useKeyboard } from "@opentui/solid";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { compactText } from "./message-normalizer";
import { SessionGateway } from "./session-gateway";
import { groupThreadRows, type AgentSession } from "./thread-catalog";
import { handleThreadKeyboard } from "./tui-keyboard";
import { loadSessions, loadSessionTranscript } from "./tui-loader";
import { padCell, rowActionHint, rowPreviewColor, rowStatusText, rowTime, rowTimeColor, rowTitle, rowTitleColor, statusColor, truncate } from "./tui-format";

const activeSessionIDs = new Set<string>();
const draftSessionID = "__opencode-threads-draft__";

export type AgentViewRouteProps = {
  api: TuiPluginApi;
  fromSessionID?: string;
};

export function AgentViewRoute(props: AgentViewRouteProps) {
  let scroll: ScrollBoxRenderable | undefined;
  let promptRef: TuiPromptRef | undefined;
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [selectedSessionID, setSelectedSessionID] = createSignal<string | undefined>();
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [selectedRefreshKey, setSelectedRefreshKey] = createSignal(0);
  const [liveFrame, setLiveFrame] = createSignal(0);
  const [timeTick, setTimeTick] = createSignal(0);
  const [promptOpen, setPromptOpen] = createSignal(false);
  const [draftPromptOpen, setDraftPromptOpen] = createSignal(false);
  const [optimisticSession, setOptimisticSession] = createSignal<AgentSession>();
  const [sessions, { refetch }] = createResource(refreshKey, () => loadSessions(props.api));
  const theme = () => props.api.theme.current;
  const visibleSessions = createMemo(() => {
    const rows = [ ...(((sessions as any).latest ?? sessions() ?? []) as AgentSession[]) ];
    const optimistic = optimisticSession();
    if (optimistic && !rows.some((row) => row.id === optimistic.id)) rows.unshift(optimistic);
    if (draftPromptOpen()) {
      rows.unshift({
        id: draftSessionID,
        draft: true,
        title: "New session",
        status: "draft",
        statusTone: "waiting",
        preview: "Type a prompt below to start a new thread.",
        transcript: [],
        updatedAt: Date.now(),
        loadedAt: Date.now(),
        waitingCount: 0,
        depth: 0,
      });
    }
    return rows;
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
  const [selectedTranscript, { refetch: refetchSelectedTranscript }] = createResource(
    () => ({ id: selectedID(), key: selectedRefreshKey() }),
    async ({ id }) => (id && id !== draftSessionID ? loadSessionTranscript(props.api.client, id) : undefined),
  );
  const selectedPeek = createMemo(() => {
    const row = selected();
    const transcript = selectedTranscript();
    return row && transcript?.id === row.id ? transcript : undefined;
  });

  const refresh = () => {
    if (selected()?.id) setSelectedSessionID(selected()?.id);
    setRefreshKey((value) => value + 1);
    void refetch();
  };

  const refreshSelected = () => {
    setSelectedRefreshKey((value) => value + 1);
    void refetchSelectedTranscript();
  };

  const closePrompt = () => {
    promptRef?.blur();
    promptRef?.reset();
    setPromptOpen(false);
    setDraftPromptOpen(false);
    if (selectedID() === draftSessionID) setSelectedSessionID(undefined);
    scroll?.focus();
  };

  const replyInline = () => {
    setDraftPromptOpen(false);
    setPromptOpen(true);
    queueMicrotask(() => promptRef?.focus());
  };

  const newAgent = () => {
    setPromptOpen(true);
    setDraftPromptOpen(true);
    setSelectedSessionID(draftSessionID);
    setSelectedIndex(0);
    queueMicrotask(() => promptRef?.focus());
  };

  const submitDraft = async () => {
    const prompt = compactText(promptRef?.current.input);
    if (!prompt) return;

    const now = Date.now();
    const gateway = new SessionGateway(props.api.client);
    promptRef?.blur();
    promptRef?.reset();
    setPromptOpen(false);
    setDraftPromptOpen(false);

    const { id: sessionID } = await gateway.create(truncate(prompt, 80));
    const optimistic: AgentSession = {
      id: sessionID,
      title: truncate(prompt, 80),
      status: "running",
      statusTone: "running",
      preview: `👤 ${prompt}`,
      transcript: [{ speaker: "You", text: prompt }],
      updatedAt: now,
      loadedAt: now,
      waitingCount: 0,
      depth: 0,
    };
    activeSessionIDs.add(sessionID);
    setOptimisticSession(optimistic);
    setSelectedSessionID(sessionID);
    setSelectedIndex(0);
    scroll?.focus();

    await gateway.sendPrompt(sessionID, prompt);
    props.api.ui.toast({ variant: "success", message: "Thread started." });
    refreshSelected();
    refresh();
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

    await new SessionGateway(props.api.client).archive(row.id);
    activeSessionIDs.delete(row.id);
    setSelectedSessionID(undefined);
    setSelectedIndex((index) => Math.max(0, index - 1));
    props.api.ui.toast({ variant: "warning", message: "Session archived." });
    refresh();
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

  useKeyboard((evt) => handleThreadKeyboard(evt, {
    dialogOpen: () => props.api.ui.dialog.open,
    promptOpen,
    closePrompt,
    goBack,
    moveSelection,
    attachSelected,
    newAgent,
    replyInline,
    abortSelected: () => void abortSelected(),
    archiveSelected: () => void archiveSelected(),
    deleteSelected: () => void deleteSelected(),
  }));

  onMount(() => {
    for (const row of visibleSessions()) {
      if (row.statusTone === "waiting" || row.statusTone === "running") activeSessionIDs.add(row.id);
    }

    scroll?.focus();
    const disposers = [
      props.api.event.on("session.created", (event: any) => {
        const sessionID = event.properties?.info?.id ?? event.properties?.sessionID ?? event.properties?.id;
        if (typeof sessionID === "string") activeSessionIDs.add(sessionID);
        refresh();
      }),
      props.api.event.on("session.updated", refresh),
      props.api.event.on("session.status", (event: any) => {
        const sessionID = event.properties?.sessionID ?? event.properties?.id;
        if (typeof sessionID === "string") activeSessionIDs.add(sessionID);
        refresh();
      }),
      props.api.event.on("message.updated", () => {
        refreshSelected();
        refresh();
      }),
      props.api.event.on("permission.asked", refresh),
      props.api.event.on("permission.replied", refresh),
    ];
    const selectedTimer = setInterval(refreshSelected, 1200);
    const listTimer = setInterval(refresh, 6000);
    const liveTimer = setInterval(() => setLiveFrame((frame) => frame + 1), 90);
    const timeTimer = setInterval(() => setTimeTick((tick) => tick + 1), 1000);
    disposers.push(
      () => clearInterval(selectedTimer),
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
    promptRef?.blur();
    promptRef?.reset();
    if (!draftPromptOpen()) setPromptOpen(false);
    refreshSelected();
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
        <scrollbox
          ref={(renderable: ScrollBoxRenderable) => (scroll = renderable)}
          minHeight={0}
          flexGrow={1}
          focusable
          scrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column" width="100%">
            <Show when={!sessions.loading || visibleSessions().length > 0} fallback={<text fg={theme().textMuted}>Loading sessions...</text>}>
              <For each={groups()} fallback={<text fg={theme().textMuted}>No sessions yet. Press n to start one.</text>}>
                {(group) => (
                  <box flexDirection="column" paddingTop={1}>
                    <box flexDirection="row" gap={1}>
                      <text fg={theme().textMuted} attributes={TextAttributes.BOLD}>{group.title}</text>
                      <Show when={group.title === "Active" && sessions.loading && visibleSessions().length > 0}>
                        <text fg={theme().textMuted}>◌</text>
                      </Show>
                    </box>
                    <For each={group.rows}>
                      {(row) => {
                        const globalIndex = () => listRows().findIndex((item) => item.id === row.id);
                        const selectedRow = () => selected()?.id === row.id;
                        const preview = () => selectedRow() ? selectedPeek()?.preview : undefined;
                        return (
                          <box
                            id={`thread-row-${row.id}`}
                            flexDirection="row"
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
                            >
                              {padCell(truncate(rowTitle(row), 34), 36)}
                            </text>
                            <text
                              fg={rowPreviewColor(theme(), row, selectedRow())}
                              wrapMode="none"
                            >
                              {padCell(rowActionHint(row, selectedRow(), preview()), 72)}
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

        <box
          flexDirection="column"
          height={12}
          border={["top"]}
          borderColor={theme().borderSubtle}
          paddingTop={1}
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={1}
        >
          <Show when={selected()} keyed fallback={<text fg={theme().textMuted}>Select a session.</text>}>
            {(row) => (
              <box flexDirection="column" gap={1} height="100%">
                <box flexDirection="row" gap={2}>
                  <text fg={theme().text} attributes={TextAttributes.BOLD}>{row.title}</text>
                  <Show when={row.statusTone !== "done"}>
                    <text fg={statusColor(theme(), row.statusTone)}>{row.status}</text>
                  </Show>
                  <text fg={theme().textMuted}>{rowTime(row, timeTick())}</text>
                </box>

                <box flexDirection="column" gap={1}>
                  <text fg={theme().textMuted} wrapMode="word">
                    {row.draft ? "New session" : "Press r to reply"}
                  </text>
                </box>

                <box paddingTop={0} flexDirection="column" gap={0} flexGrow={1} minHeight={0}>
                  <Show
                    when={promptOpen()}
                    fallback={(
                      <box
                        flexDirection="column"
                        height={4}
                        paddingLeft={2}
                        paddingTop={1}
                        backgroundColor={theme().backgroundElement}
                      >
                        <text fg={theme().textMuted} wrapMode="none">
                          {row.draft ? "Start a new thread..." : "Reply to this thread..."}
                        </text>
                      </box>
                    )}
                  >
                    <props.api.ui.Prompt
                      sessionID={row.draft ? undefined : row.id}
                      visible
                      ref={(ref) => (promptRef = ref)}
                      onSubmit={() => {
                        if (row.draft) {
                          void submitDraft();
                          return;
                        }
                        promptRef?.blur();
                        setPromptOpen(false);
                        scroll?.focus();
                        refreshSelected();
                        refresh();
                      }}
                      showPlaceholder
                      placeholders={{ normal: [row.draft ? "Start a new thread..." : "Reply to this thread..."] }}
                    />
                  </Show>
                </box>
              </box>
            )}
          </Show>
        </box>
      </box>
    </box>
  );
}
