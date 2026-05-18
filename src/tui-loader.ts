import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { latestTurnText, orderedMessages, sessionTranscript, type TranscriptTurn } from "./message-normalizer";
import { SessionGateway } from "./session-gateway";
import { readThreadRelations } from "./thread-relations";
import { buildThreadRows, type AgentSession } from "./thread-catalog";

export async function loadSessionTranscript(client: any, sessionID: string): Promise<{ id: string; preview: string; transcript: TranscriptTurn[] }> {
  try {
    const messages = orderedMessages(await new SessionGateway(client).messages(sessionID, 48));
    const transcript = sessionTranscript(messages);
    return { id: sessionID, preview: latestTurnText(messages), transcript };
  } catch {
    return { id: sessionID, preview: "Preview unavailable.", transcript: [] };
  }
}

export async function loadSessions(api: TuiPluginApi): Promise<AgentSession[]> {
  const gateway = new SessionGateway(api.client);
  const rawSessions = await gateway.list();
  const statusMap = await gateway.status();
  const relations = await readThreadRelations();
  const loadedAt = Date.now();

  return buildThreadRows({
    rawSessions,
    statusMap,
    relations,
    loadedAt,
    getWaitingCount: (sessionID) => (
      api.state.session.permission(sessionID).length
      + api.state.session.question(sessionID).length
    ),
    loadTranscript: (sessionID) => loadSessionTranscript(api.client, sessionID),
  });
}
