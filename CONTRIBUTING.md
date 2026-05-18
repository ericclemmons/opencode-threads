# Contributing

Use this guide when developing `opencode-threads` locally. If you only want to use the plugin in your app, follow the installation steps in `README.md` instead.

## Requirements

- OpenCode `>=1.4.0`
- Node/npm
- Bun, because the build script runs with `bun`

## Setup

```bash
npm install
npm run typecheck
npm run build
```

## Local Development Install

Install the local checkout into OpenCode while working on it:

```bash
opencode plugin /path/to/opencode-threads --global --force
```

From this checkout, that is:

```bash
opencode plugin /Users/eric/Projects/ericclemmons/opencode-threads --global --force
```

This writes the server plugin to `~/.config/opencode/opencode.json` and the TUI plugin to `~/.config/opencode/tui.json`.

Restart OpenCode, then run `/threads`.

## Development Loop

1. Edit files in `src/`.
2. Run `npm run typecheck`.
3. Run `npm run build`.
4. Restart OpenCode after changing server exports, TUI exports, or build output.
5. Run `/threads` to test the TUI and `/threads <request>` to test session spawning.

## Useful Commands

```bash
npm run typecheck
npm run build
npm pack --dry-run
```

## Local State

OpenCode Threads stores UI-only thread nesting at:

```text
$XDG_STATE_HOME/opencode-threads/threads.json
```

If `XDG_STATE_HOME` is unset, it falls back to `~/.local/state/opencode-threads/threads.json`.

Delete that file if you need to reset local nesting state while testing.
