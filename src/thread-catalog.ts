import { compactText, displayTime, type TranscriptTurn } from "./message-normalizer";
import type { ThreadRelations } from "./thread-relations";

export type AgentSession = {
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

export type SessionGroup = {
  title: string;
  rows: AgentSession[];
};

export type BuildThreadRowsInput = {
  rawSessions: any[];
  statusMap: Record<string, any>;
  relations: ThreadRelations;
  loadedAt: number;
  getWaitingCount: (sessionID: string) => number;
  loadTranscript: (sessionID: string) => Promise<{ preview: string; transcript: TranscriptTurn[] }>;
};

export async function buildThreadRows(input: BuildThreadRowsInput): Promise<AgentSession[]> {
  const rows = await Promise.all(
    input.rawSessions.filter((session) => !isArchivedSession(session) && !isHiddenSubAgentSession(session)).map(async (session) => {
      const sessionID = String(session.id);
      const sdkStatus = input.statusMap[sessionID];
      const waitingCount = input.getWaitingCount(sessionID);
      const rawStatus = sdkStatus?.status ?? sdkStatus?.type ?? "idle";
      const status = waitingCount > 0 ? "waiting" : String(rawStatus);
      const statusTone = getStatusTone(status);
      const transcript = await input.loadTranscript(sessionID);

      return {
        id: sessionID,
        parentID: input.relations[sessionID] ?? (typeof session.parentID === "string" ? session.parentID : undefined),
        title: compactText(session.title) || "Untitled session",
        status,
        statusTone,
        preview: transcript.preview,
        transcript: transcript.transcript,
        updatedAt: displayTime(session.time?.updated ?? session.updatedAt ?? session.updated_at ?? session.modified),
        loadedAt: input.loadedAt,
        waitingCount,
        depth: 0,
      } satisfies AgentSession;
    }),
  );

  return flattenNestedThreadRows(rows);
}

export function flattenNestedThreadRows(rows: AgentSession[]): AgentSession[] {
  const rowIDs = new Set(rows.map((row) => row.id));
  const children = new Map<string, AgentSession[]>();
  const roots: AgentSession[] = [];

  for (const row of rows) {
    if (!row.parentID || row.parentID === row.id || !rowIDs.has(row.parentID)) {
      roots.push({ ...row, parentID: undefined, depth: 0 });
      continue;
    }

    const list = children.get(row.parentID) ?? [];
    list.push(row);
    children.set(row.parentID, list);
  }

  for (const list of children.values()) {
    list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  roots.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const flattened: AgentSession[] = [];
  const visited = new Set<string>();
  const append = (row: AgentSession, depth: number) => {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    flattened.push({ ...row, depth });
    for (const child of children.get(row.id) ?? []) append(child, depth + 1);
  };

  for (const root of roots) append(root, 0);
  for (const row of rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))) {
    if (!visited.has(row.id)) append({ ...row, parentID: undefined }, 0);
  }

  return flattened;
}

export function groupThreadRows(rows: readonly AgentSession[], activeSessionIDs: ReadonlySet<string>, now = new Date()): SessionGroup[] {
  const children = new Map<string, AgentSession[]>();
  const roots = rows.filter((row) => !row.parentID);
  for (const row of rows) {
    if (!row.parentID) continue;
    const list = children.get(row.parentID) ?? [];
    list.push(row);
    children.set(row.parentID, list);
  }

  const descendants = (row: AgentSession): AgentSession[] => (children.get(row.id) ?? []).flatMap((child) => [child, ...descendants(child)]);
  const rowActive = (row: AgentSession): boolean => activeSessionIDs.has(row.id) || row.statusTone === "waiting" || row.statusTone === "running";
  const subtreeActive = (row: AgentSession): boolean => rowActive(row) || (children.get(row.id) ?? []).some(subtreeActive);
  const active = roots.filter(subtreeActive);
  const previous = roots.filter((row) => !active.includes(row));
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - now.getDay() * 24 * 60 * 60 * 1000;
  const startOfLastWeek = startOfWeek - 7 * 24 * 60 * 60 * 1000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();

  const today = [...active, ...previous.filter((row) => (row.updatedAt ?? 0) >= startOfToday)];
  const yesterday = previous.filter((row) => (row.updatedAt ?? 0) >= startOfYesterday && (row.updatedAt ?? 0) < startOfToday);
  const thisWeek = previous.filter((row) => (row.updatedAt ?? 0) >= startOfWeek && (row.updatedAt ?? 0) < startOfYesterday);
  const lastWeek = previous.filter((row) => (row.updatedAt ?? 0) >= startOfLastWeek && (row.updatedAt ?? 0) < startOfWeek);
  const thisMonth = previous.filter((row) => (row.updatedAt ?? 0) >= startOfMonth && (row.updatedAt ?? 0) < startOfLastWeek);
  const lastMonth = previous.filter((row) => (row.updatedAt ?? 0) >= startOfLastMonth && (row.updatedAt ?? 0) < startOfMonth);
  const older = previous.filter((row) => (row.updatedAt ?? 0) < startOfLastMonth);

  const withChildren = (groupRows: AgentSession[]) => groupRows.flatMap((row) => [row, ...descendants(row)]);

  return [
    { title: "Today", rows: withChildren(today) },
    { title: "Yesterday", rows: withChildren(yesterday) },
    { title: "This week", rows: withChildren(thisWeek) },
    { title: "Last week", rows: withChildren(lastWeek) },
    { title: "This month", rows: withChildren(thisMonth) },
    { title: "Last month", rows: withChildren(lastMonth) },
    { title: "Older", rows: withChildren(older) },
  ].filter((group) => group.rows.length > 0);
}

export function isArchivedSession(session: any): boolean {
  return typeof session?.time?.archived === "number";
}

export function isHiddenSubAgentSession(session: any): boolean {
  if (!session?.parentID) return false;
  const title = compactText(session.title);
  return /\(@[^)]+\s+subagent\)$/i.test(title) || /^Run .+\(@[^)]+\)$/i.test(title);
}

export function getStatusTone(status: string): AgentSession["statusTone"] {
  const value = status.toLowerCase();
  if (value.includes("wait") || value.includes("question") || value.includes("permission")) return "waiting";
  if (value.includes("run") || value.includes("busy") || value.includes("process")) return "running";
  if (value.includes("error") || value.includes("fail")) return "error";
  return "done";
}
