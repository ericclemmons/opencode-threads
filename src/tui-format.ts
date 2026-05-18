import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { AgentSession } from "./thread-catalog";

export type Theme = TuiPluginApi["theme"]["current"];

const liveFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function relativeTime(value?: number, now = Date.now()): string {
  if (!value) return "unknown";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

export function padCell(value: string, width: number): string {
  return truncate(value, width).padEnd(width, " ");
}

export function rowTitle(row: AgentSession): string {
  return row.depth > 0 ? `  ${row.title}` : row.title;
}

export function rowActionHint(row: AgentSession, _selected: boolean, preview?: string): string {
  return preview ?? row.preview;
}

export function rowStatusText(row: AgentSession, frame = 0, offset = 0): string {
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

export function rowTitleColor(theme: Theme, _row: AgentSession, selected: boolean) {
  if (selected) return theme.warning;
  return theme.text;
}

export function rowPreviewColor(theme: Theme, row: AgentSession, selected: boolean) {
  if (selected) return theme.text;
  return isOlderRow(row) ? theme.textMuted : theme.textMuted;
}

export function rowTimeColor(theme: Theme, selected: boolean) {
  return selected ? theme.text : theme.textMuted;
}

export function rowTime(row: AgentSession, _tick: number): string {
  if (row.draft) return "now";
  return relativeTime(row.updatedAt, row.statusTone === "running" ? Date.now() : row.loadedAt);
}

export function statusColor(theme: Theme, tone: AgentSession["statusTone"]) {
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

function isOlderRow(row: AgentSession): boolean {
  if (!row.updatedAt) return false;
  return Date.now() - row.updatedAt > 14 * 24 * 60 * 60 * 1000;
}
