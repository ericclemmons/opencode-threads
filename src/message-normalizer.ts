export type TranscriptTurn = {
  role?: "user" | "assistant" | "note" | "activity";
  speaker?: string;
  text: string;
  mode?: string;
  model?: string;
};

export function compactText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").trim();
}

export function cleanPreviewText(input: unknown): string {
  return compactText(input)
    .replace(/<[^>]+>/g, " ")
    .replace(/\bTypeScriptg?typecheck(?:ing)?\b/gi, "TypeScript typecheck")
    .replace(/\[(?:step|session|message|part|text|reasoning|tool)-[^\]]+\]\s*/gi, "")
    .replace(/\[(?:step-start|step-finish)\]\s*/gi, "")
    .replace(/```[^`]*```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(?:^|\s)-\s+/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();
}

function cleanTranscriptText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/\r\n/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\bTypeScriptg?typecheck(?:ing)?\b/gi, "TypeScript typecheck")
    .replace(/\[(?:step|session|message|part|text|reasoning|tool)-[^\]]+\]\s*/gi, "")
    .replace(/\[(?:step-start|step-finish)\]\s*/gi, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function partText(part: any, format: "preview" | "transcript" = "preview"): string {
  if (!part || typeof part !== "object") return "";
  const type = typeof part.type === "string" ? part.type : "";
  if (type && /^(step-|reasoning|tool|agent-|model-|session-|message-|part-)/i.test(type)) return "";
  const clean = format === "transcript" ? cleanTranscriptText : cleanPreviewText;
  if (typeof part.text === "string") return clean(part.text);
  if (typeof part.content === "string") return clean(part.content);
  if (typeof part.summary === "string") return clean(part.summary);
  return "";
}

function partActivity(part: any): string {
  if (!part || typeof part !== "object") return "";
  if (part.type !== "tool") return "";

  const status = typeof part.state?.status === "string" ? part.state.status : "running";
  const title = cleanPreviewText(part.state?.title);
  const toolName = typeof part.tool === "string" ? part.tool : "tool";
  const running = status === "running" || status === "pending";

  if (title) return title;
  if (toolName === "apply_patch") return running ? "Editing files" : "Edited files";
  if (toolName === "bash") return running ? "Running command" : "Ran command";
  if (toolName === "read") return running ? "Reading file" : "Read file";
  if (toolName === "grep") return running ? "Searching" : "Searched";
  if (toolName === "glob") return running ? "Scanning files" : "Scanned files";
  if (toolName === "webfetch") return running ? "Fetching page" : "Fetched page";
  if (toolName === "task") return running ? "Delegating task" : "Delegated task";
  return running ? "Working" : "Updated";
}

function messageParts(message: any): any[] {
  return Array.isArray(message?.content)
    ? message.content
    : Array.isArray(message?.parts)
      ? message.parts
      : Array.isArray(message?.info?.parts)
        ? message.info.parts
        : [];
}

function messageType(message: any): string {
  return typeof message?.type === "string" ? message.type : "";
}

function isLifecycleMessage(message: any): boolean {
  const type = messageType(message);
  return Boolean(type && /^(step-|reasoning|tool|agent-|model-|session-|message-|part-)/i.test(type));
}

function visibleMessageText(message: any, includeToolActivity: boolean, format: "preview" | "transcript" = "preview"): string {
  const parts = messageParts(message);
  const fromParts = format === "transcript"
    ? parts.map((part) => partText(part, format)).filter(Boolean).join("\n\n").trim()
    : compactText(parts.map((part) => partText(part)).filter(Boolean).join(" "));
  if (fromParts) return fromParts;

  if (includeToolActivity) {
    const activity = compactText(parts.map(partActivity).filter(Boolean).join(" / "));
    if (activity) return activity;
  }

  if (isLifecycleMessage(message)) return "";
  const clean = format === "transcript" ? cleanTranscriptText : cleanPreviewText;
  return clean(message?.info?.text ?? message?.text ?? message?.content ?? message?.summary ?? message?.command ?? message?.output);
}

export function coordinatorMessageSpeaker(message: any): string {
  const role = message?.info?.role ?? message?.role ?? message?.type;
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  return "Note";
}

export function transcriptMessageSpeaker(message: any): string {
  const role = message?.info?.role ?? message?.role ?? message?.type;
  if (role === "user") return "You";
  if (role === "assistant") return "Agent";
  if (role === "synthetic") return "Note";
  return "";
}

export function transcriptMessageRole(message: any): TranscriptTurn["role"] {
  const role = message?.info?.role ?? message?.role ?? message?.type;
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "synthetic") return "note";
  return undefined;
}

export function coordinatorContextLines(messages: any[], limit = 12): string[] {
  return messages
    .map((message) => {
      const text = visibleMessageText(message, false);
      return text ? `${coordinatorMessageSpeaker(message)}: ${text}` : "";
    })
    .filter(Boolean)
    .slice(-limit);
}

export function visibleTranscriptTurn(message: any): TranscriptTurn | undefined {
  const text = visibleMessageText(message, true, "transcript");
  if (!text) return undefined;
  const role = transcriptMessageRole(message) ?? (messageParts(message).some((part) => part?.type === "tool") ? "activity" : undefined);
  return {
    role,
    speaker: transcriptMessageSpeaker(message),
    text: cleanTranscriptText(text),
    mode: typeof message?.mode === "string" ? message.mode : undefined,
    model: compactText(message?.modelID ?? message?.model),
  };
}

export function messageTime(message: any): number {
  return displayTime(message?.time?.created ?? message?.time?.updated ?? message?.info?.time?.created ?? message?.createdAt ?? message?.created_at) ?? 0;
}

export function orderedMessages(messages: any[]): any[] {
  return [...messages].sort((a, b) => messageTime(a) - messageTime(b));
}

export function sessionTranscript(messages: any[], limit = 8): TranscriptTurn[] {
  const turns = messages.map(visibleTranscriptTurn).filter(Boolean) as TranscriptTurn[];
  return Number.isFinite(limit) ? turns.slice(-limit) : turns;
}

export function latestTurnText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const turn = visibleTranscriptTurn(messages[i]);
    if (turn) return `${previewPrefix(turn.speaker)}${compactText(turn.text)}`;
  }

  return "No assistant reply yet";
}

export function displayTime(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function previewPrefix(speaker?: string): string {
  if (speaker === "You") return "👤 ";
  if (speaker === "Note") return "→ ";
  return "";
}
