# OpenCode Threads

Threaded session manager and task splitter for OpenCode.

OpenCode Threads adds a `/threads` view for managing sessions and a `spawn_threads` tool that lets the model split multi-item work into separate user-continuable sessions.

## Features

- `/threads` opens a session/thread manager in the OpenCode TUI.
- `n` creates a new session draft at the top of the list.
- `r` focuses the bottom prompt dock for the selected session.
- `enter` attaches to the selected session.
- `delete` asks before permanently deleting a session.
- `cmd+delete` archives a session immediately.
- `/threads <request>` injects a coordinator prompt that identifies N items and creates N user-continuable sessions.
- Spawned sessions are visually nested with a UI-only relation map until OpenCode exposes native enterable thread nesting.

## Install Locally

```bash
opencode plugin /Users/eric/Projects/ericclemmons/opencode-threads --global --force
```

Then restart OpenCode and run `/threads`.

OpenCode writes server plugins to `opencode.json` and TUI plugins to `tui.json`.

Global locations:

- `~/.config/opencode/opencode.json`
- `~/.config/opencode/tui.json`

Project locations:

- `.opencode/opencode.json`
- `.opencode/tui.json`

## Development

```bash
npm install
npm run typecheck
npm run build
```

Restart OpenCode after changing server exports, TUI exports, or build output.

## Commands

- `/threads`: open the thread manager.
- `/threads <request>`: ask the coordinator to split a multi-item request into one session per item.

Example:

```text
/threads summarize the top 3 tech stories today
```

The coordinator should identify the three stories, then create three user-continuable sessions with singular prompts.

## Notes

The plugin intentionally does not register `/agents` because OpenCode already provides that as a built-in command.

UI-only nesting is stored at `~/.local/share/opencode-threads/threads.json`. This can be removed if OpenCode adds native enterable thread nesting: https://github.com/anomalyco/opencode/issues/16639
