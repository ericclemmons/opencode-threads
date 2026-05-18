export type ThreadKeyboardEvent = {
  defaultPrevented?: boolean;
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  super?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
};

export type ThreadKeyboardHandlers = {
  dialogOpen: () => boolean;
  promptOpen: () => boolean;
  peekOpen: () => boolean;
  closePrompt: () => void;
  closePeek: () => void;
  goBack: () => void;
  moveSelection: (delta: number) => void;
  attachSelected: () => void;
  newAgent: () => void;
  replyInline: () => void;
  togglePeek: () => void;
  abortSelected: () => void;
  archiveSelected: () => void;
  deleteSelected: () => void;
};

export function handleThreadKeyboard(evt: ThreadKeyboardEvent, handlers: ThreadKeyboardHandlers) {
  if (evt.defaultPrevented || handlers.dialogOpen()) return;

  if (evt.name === "escape") {
    prevent(evt);
    if (handlers.promptOpen()) {
      handlers.closePrompt();
      return;
    }
    if (handlers.peekOpen()) {
      handlers.closePeek();
      return;
    }
    handlers.goBack();
    return;
  }

  if (evt.ctrl || evt.meta || evt.super) return;

  if (handlers.promptOpen()) return;

  if (evt.name === "space" || evt.name === " ") {
    prevent(evt);
    handlers.togglePeek();
    return;
  }

  if (evt.name === "r") {
    prevent(evt);
    handlers.replyInline();
    return;
  }

  if (handlers.peekOpen()) return;

  if (evt.name === "up" || evt.name === "k") {
    prevent(evt);
    handlers.moveSelection(-1);
    return;
  }

  if (evt.name === "down" || evt.name === "j") {
    prevent(evt);
    handlers.moveSelection(1);
    return;
  }

  if (evt.name === "return") {
    prevent(evt);
    handlers.attachSelected();
    return;
  }

  if (evt.name === "n") {
    prevent(evt);
    handlers.newAgent();
    return;
  }

  if (evt.name === "a") {
    prevent(evt);
    handlers.abortSelected();
    return;
  }

  if (evt.name === "delete" || evt.name === "backspace") {
    prevent(evt);
    if (evt.meta || evt.super) {
      handlers.archiveSelected();
      return;
    }
    handlers.deleteSelected();
  }
}

function prevent(evt: ThreadKeyboardEvent) {
  evt.preventDefault();
  evt.stopPropagation();
}
