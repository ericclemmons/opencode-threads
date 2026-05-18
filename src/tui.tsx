/** @jsxImportSource @opentui/solid */

import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui";
import { useKeyboard } from "@opentui/solid";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { compactText, displayTime, latestTurnText, orderedMessages, sessionTranscript, type TranscriptTurn } from "./message-normalizer";
import { SessionGateway } from "./session-gateway";
import { readThreadRelations } from "./thread-relations";

const id = "opencode.threads";
const routeName = "threads";

type AgentSession = {
  id: string;
  parentID?: string;
  draft?: boolean;
  title: string;
  status: string;
  statusTone: "waiting" | "running" | "done" | "error";
  preview: string;
  transcript: TranscriptTurn[];
  updatedAt?: number;
  loadedAt: number;
  waitingCount: number;
  depth: number;
};

type Theme = TuiPluginApi["theme"]["current"];

type SessionGroup = {
  title: string;
  rows: AgentSession[];
};

const activeSessionIDs = new Set<string>();
const liveFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const draftSessionID = "__opencode-threads-draft__";

type AgentViewRouteProps = {
  api: TuiPluginApi;
  fromSessionID?: string;
};

function relativeTime(value?: number, now = Date.now()): string {
  if (!value) return "unknown";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

async function loadSessionTranscript(client: any, sessionID: string): Promise<{ id: string; preview: string; transcript: TranscriptTurn[] }> {
  try {
    const messages = orderedMessages(await new SessionGateway(client).messages(sessionID, 48));
    const transcript = sessionTranscript(messages);
    return { id: sessionID, preview: latestTurnText(messages), transcript };
  } catch {
    return { id: sessionID, preview: "Preview unavailable.", transcript: [] };
  }
}

async function loadSessions(api: TuiPluginApi): Promise<AgentSession[]> {
  const gateway = new SessionGateway(api.client);
  const rawSessions = await gateway.list();
  const statusMap = await gateway.status();
  const relations = await readThreadRelations();
  const loadedAt = Date.now();

  const rows = await Promise.all(
    rawSessions.filter((session) => !isHiddenSubAgentSession(session)).map(async (session) => {
      const sessionID = String(session.id);
      const stateStatus = api.state.session.status(sessionID) as any;
      const sdkStatus = statusMap[sessionID];
      const rawStatus = stateStatus?.status ?? sdkStatus?.status ?? stateStatus?.type ?? sdkStatus?.type ?? "idle";
      const permissionCount = api.state.session.permission(sessionID).length;
      const questionCount = api.state.session.question(sessionID).length;
      const waitingCount = permissionCount + questionCount;
      const status = waitingCount > 0 ? "waiting" : String(rawStatus);
      const statusTone = getStatusTone(status);
      const transcript = await loadSessionTranscript(api.client, sessionID);

      return {
        id: sessionID,
        parentID: relations[sessionID] ?? (typeof session.parentID === "string" ? session.parentID : undefined),
        title: compactText(session.title) || "Untitled session",
        status,
        statusTone,
        preview: transcript.preview,
        transcript: transcript.transcript,
        updatedAt: displayTime(session.time?.updated ?? session.updatedAt ?? session.updated_at ?? session.modified),
        loadedAt,
        waitingCount,
        depth: 0,
      };
    }),
  );

  const children = new Map<string, AgentSession[]>();
  const roots = rows.filter((row) => !row.parentID);
  const rootIDs = new Set(roots.map((row) => row.id));

  for (const row of rows) {
    if (!row.parentID || !rootIDs.has(row.parentID)) continue;
    const list = children.get(row.parentID) ?? [];
    list.push({ ...row, depth: 1 });
    children.set(row.parentID, list);
  }

  for (const list of children.values()) {
    list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  return roots
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .flatMap((row) => [row, ...(children.get(row.id) ?? [])]);
}

function isHiddenSubAgentSession(session: any): boolean {
  if (!session?.parentID) return false;
  const title = compactText(session.title);
  return /\(@[^)]+\s+subagent\)$/i.test(title) || /^Run .+\(@[^)]+\)$/i.test(title);
}

function getStatusTone(status: string): AgentSession["statusTone"] {
  const value = status.toLowerCase();
  if (value.includes("wait") || value.includes("question") || value.includes("permission")) return "waiting";
  if (value.includes("run") || value.includes("busy") || value.includes("process")) return "running";
  if (value.includes("error") || value.includes("fail")) return "error";
  return "done";
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

function padCell(value: string, width: number): string {
  return truncate(value, width).padEnd(width, " ");
}

function rowMarker(row: AgentSession): string {
  if (row.depth > 0) return "↳";
  switch (row.statusTone) {
    case "waiting":
      return "*";
    case "running":
      return "*";
    case "error":
      return "!";
    case "done":
      return "·";
  }
}

function rowTitle(row: AgentSession): string {
  return row.depth > 0 ? `  ${row.title}` : row.title;
}

function groupedSessions(rows: readonly AgentSession[]): SessionGroup[] {
  const children = new Map<string, AgentSession[]>();
  const roots = rows.filter((row) => !row.parentID);
  for (const row of rows) {
    if (!row.parentID) continue;
    const list = children.get(row.parentID) ?? [];
    list.push(row);
    children.set(row.parentID, list);
  }

  const rowActive = (row: AgentSession) => activeSessionIDs.has(row.id) || row.statusTone === "waiting" || row.statusTone === "running";
  const active = roots.filter((row) => rowActive(row) || (children.get(row.id) ?? []).some(rowActive));
  const previous = roots.filter((row) => !active.includes(row));
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - now.getDay() * 24 * 60 * 60 * 1000;
  const startOfLastWeek = startOfWeek - 7 * 24 * 60 * 60 * 1000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();

  const today = previous.filter((row) => (row.updatedAt ?? 0) >= startOfToday);
  const yesterday = previous.filter((row) => (row.updatedAt ?? 0) >= startOfYesterday && (row.updatedAt ?? 0) < startOfToday);
  const thisWeek = previous.filter((row) => (row.updatedAt ?? 0) >= startOfWeek && (row.updatedAt ?? 0) < startOfYesterday);
  const lastWeek = previous.filter((row) => (row.updatedAt ?? 0) >= startOfLastWeek && (row.updatedAt ?? 0) < startOfWeek);
  const thisMonth = previous.filter((row) => (row.updatedAt ?? 0) >= startOfMonth && (row.updatedAt ?? 0) < startOfLastWeek);
  const lastMonth = previous.filter((row) => (row.updatedAt ?? 0) >= startOfLastMonth && (row.updatedAt ?? 0) < startOfMonth);
  const older = previous.filter((row) => (row.updatedAt ?? 0) < startOfLastMonth);

  const withChildren = (groupRows: AgentSession[]) => groupRows.flatMap((row) => [row, ...(children.get(row.id) ?? [])]);

  return [
    { title: "Active", rows: withChildren(active) },
    { title: "Today", rows: withChildren(today) },
    { title: "Yesterday", rows: withChildren(yesterday) },
    { title: "This week", rows: withChildren(thisWeek) },
    { title: "Last week", rows: withChildren(lastWeek) },
    { title: "This month", rows: withChildren(thisMonth) },
    { title: "Last month", rows: withChildren(lastMonth) },
    { title: "Older", rows: withChildren(older) },
  ].filter((group) => group.rows.length > 0);
}

function sessionRowText(row: AgentSession, selected: boolean): string {
  const title = `${rowMarker(row)} ${row.title}`;
  const preview = selected && row.statusTone === "done" ? "-> to return" : row.preview;
  return [padCell(title, 32), padCell(preview, 86), relativeTime(row.updatedAt)].join("  ");
}

function rowActionHint(row: AgentSession, selected: boolean, preview?: string): string {
  const value = preview ?? row.preview;
  return value;
}

function rowStatusText(row: AgentSession, frame = 0, offset = 0): string {
  switch (row.statusTone) {
    case "waiting":
      return row.waitingCount > 0 ? `?${row.waitingCount}` : "?";
    case "running":
      return liveFrames[(frame + offset) % liveFrames.length];
    case "error":
      return "!";
    case "done":
      return "·";
  }
}

function isOlderRow(row: AgentSession): boolean {
  if (!row.updatedAt) return false;
  return Date.now() - row.updatedAt > 14 * 24 * 60 * 60 * 1000;
}

function rowTitleColor(theme: Theme, row: AgentSession, selected: boolean) {
  if (selected) return theme.warning;
  return theme.text;
}

function rowPreviewColor(theme: Theme, row: AgentSession, selected: boolean) {
  if (selected) return theme.text;
  return isOlderRow(row) ? theme.textMuted : theme.textMuted;
}

function rowTimeColor(theme: Theme, selected: boolean) {
  return selected ? theme.text : theme.textMuted;
}

function rowTime(row: AgentSession, _tick: number): string {
  if (row.draft) return "now";
  return relativeTime(row.updatedAt, row.statusTone === "running" ? Date.now() : row.loadedAt);
}

function peekSpeaker(preview: string): string | undefined {
  const match = /^(Agent|You|Note):\s*/.exec(preview);
  return match?.[1];
}

function peekText(preview: string): string {
  return preview.replace(/^(Agent|You|Note):\s*/, "");
}

function speakerColor(theme: Theme, speaker?: string) {
  if (speaker === "You") return theme.warning;
  if (speaker === "Agent") return theme.textMuted;
  return theme.textMuted;
}

function turnMarker(speaker?: string): string {
  if (speaker === "You") return "💬";
  if (speaker === "Note") return "→";
  return "";
}

function statusColor(theme: Theme, tone: AgentSession["statusTone"]) {
  switch (tone) {
    case "waiting":
      return theme.warning;
    case "running":
      return theme.info;
    case "error":
      return theme.error;
    case "done":
      return theme.textMuted;
  }
}

function AgentViewRoute(props: AgentViewRouteProps) {
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
  const groups = createMemo(() => groupedSessions(visibleSessions()));
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

  const summaryText = createMemo(() => {
    const rows = listRows();
    const waiting = rows.filter((row) => row.statusTone === "waiting").length;
    const working = rows.filter((row) => row.statusTone === "running").length;
    const completed = rows.filter((row) => row.statusTone === "done" || row.statusTone === "error").length;
    return { waiting, working, completed };
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

  useKeyboard((evt) => {
    if (evt.defaultPrevented || props.api.ui.dialog.open) return;
    const rows = visibleSessions();

    if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) {
      evt.preventDefault();
      evt.stopPropagation();
      if (promptOpen()) {
        promptRef?.blur();
        promptRef?.reset();
        setPromptOpen(false);
        setDraftPromptOpen(false);
        if (selectedID() === draftSessionID) setSelectedSessionID(undefined);
        scroll?.focus();
        return;
      }
      if (props.fromSessionID) props.api.route.navigate("session", { sessionID: props.fromSessionID });
      else props.api.route.navigate("home");
      return;
    }

    if (promptOpen()) return;

    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault();
      evt.stopPropagation();
      moveSelection(-1);
      return;
    }

    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault();
      evt.stopPropagation();
      moveSelection(1);
      return;
    }

    if (evt.name === "return") {
      evt.preventDefault();
      evt.stopPropagation();
      attachSelected();
      return;
    }

    if (evt.name === "n") {
      evt.preventDefault();
      evt.stopPropagation();
      newAgent();
      return;
    }

    if (evt.name === "r") {
      evt.preventDefault();
      evt.stopPropagation();
      replyInline();
      return;
    }

    if (evt.name === "a") {
      evt.preventDefault();
      evt.stopPropagation();
      void abortSelected();
      return;
    }

    if (evt.name === "delete" || evt.name === "backspace") {
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.meta || evt.super) {
        void archiveSelected();
        return;
      }
      void deleteSelected();
    }
  });

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

const tui: TuiPlugin = async (api) => {
  api.command?.register(() => [
    {
      title: "OpenCode Threads",
      value: "agents.open",
      description: "Manage all OpenCode sessions",
      category: "Plugin",
      slash: { name: "threads" },
      onSelect: () => {
        const current = api.route.current;
        api.route.navigate(
          routeName,
          current.name === "session" && current.params?.sessionID
            ? { fromSessionID: current.params.sessionID }
            : undefined,
        );
      },
    },
  ]);

  api.route.register([
    {
      name: routeName,
      render: ({ params }) => (
        <AgentViewRoute
          api={api}
          fromSessionID={typeof params?.fromSessionID === "string" ? params.fromSessionID : undefined}
        />
      ),
    },
  ]);
};

export default {
  id,
  tui,
} satisfies TuiPluginModule & { id: string };
