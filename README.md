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

## Installation

Add `opencode-threads` to your OpenCode plugin config.

For a single project, add it to `opencode.json` in your app:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-threads"]
}
```

For every project on your machine, add the same config to `~/.config/opencode/opencode.json`.

Then start or restart OpenCode and run `/threads`.

OpenCode installs npm plugins automatically at startup and caches them in `~/.cache/opencode/node_modules/`.

## TUI Plugin

OpenCode's npm plugin config loads the server plugin. OpenCode Threads also includes a TUI plugin for the `/threads` session manager. Add it to your TUI plugin config:

Project-level `.opencode/tui.json`:

```json
{
  "plugin": ["opencode-threads/tui"]
}
```

Or global `~/.config/opencode/tui.json`:

```json
{
  "plugin": ["opencode-threads/tui"]
}
```

Restart OpenCode after changing plugin config.

## Config Locations

Server plugin config:

- `~/.config/opencode/opencode.json`
- `.opencode/opencode.json` or `opencode.json` in your project

TUI plugin config:

- `~/.config/opencode/tui.json`
- `.opencode/tui.json`

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

UI-only nesting is stored at `$XDG_STATE_HOME/opencode-threads/threads.json`, falling back to `~/.local/state/opencode-threads/threads.json`. This can be removed if OpenCode adds native enterable thread nesting: https://github.com/anomalyco/opencode/issues/16639
