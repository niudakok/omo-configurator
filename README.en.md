# OmO Configurator

A desktop and browser GUI for visually editing `opencode.json` and the oh-my agent config (`oh-my-openagent.json`, with legacy support for `oh-my-opencode.json`).

**中文首页：** [README.md](README.md)

## Motivation

OpenCode and oh-my agent configs ship large, nested JSON configs. Hand-editing them in a text editor is easy to get wrong: a missing comma, a mistyped model id, or an inconsistent MCP block can break a workflow silently. This app exists to make that work safer and faster—structured forms instead of raw JSON, visibility into recommended models, bulk changes when you switch providers, and snapshots so you can roll back after experiments. It is a companion for people who live in these configs daily and want fewer surprises.

## Stack

- **Runtime**: Tauri v2 (Rust + WebView) or browser mode via Vite
- **Frontend**: React 19 + TypeScript + shadcn/ui + Tailwind CSS v4
- **Build**: Vite
- **Tests**: Vitest + Testing Library

## Development

### Prerequisites

- Node.js 20+
- **npm** (use npm for install and scripts; this project does not use `tnpm`)
- Rust 1.88+ for Tauri desktop builds
- macOS / Windows / Linux (system WebView runtime required for Tauri)

### Install dependencies

```bash
bash scripts/install.sh
```

You can also use:

```bash
npm run setup
```

### Start browser mode

Use this workflow in WSL/Linux when you want the React app in a normal browser without starting Tauri:

```bash
bash scripts/start-web.sh
```

Or via npm:

```bash
npm run start
```

Open the printed Vite URL, usually `http://localhost:1420/`. Browser mode stores editable `opencode.json`, oh-my config, and snapshots in `localStorage`. It cannot read or write `~/.config/opencode` or `~/.local/share/opencode/auth.json` directly; export snapshots from the sidebar when you want a downloadable JSON copy. External provider model loading runs through browser `fetch`, so providers blocked by CORS or network policy may not load until you use the Tauri desktop app.

### Start Tauri desktop mode

```bash
bash scripts/start-desktop.sh
```

Or via npm:

```bash
npm run start:desktop
```

### Run tests

```bash
npm run test
```

### Production build

```bash
npm run tauri build
```

## Features

### Agents & Categories tab

- Edit model and variant per agent/category in the UI
- Recommended-model indicators: green ✅ when it matches the official recommendation, orange ⚠️ when it differs (hover for the recommendation chain)
- Click an indicator to apply the official recommendation in one step

### Bulk replace

- Replace every agent/category that uses one model with another, in one action
- Confirmation dialog to reduce mistakes

### MCP servers

- Card list of all MCP servers (remote/local)
- Inline editor on expand: remote URL + headers; local command + environment variables
- Add and remove servers

### Providers

- Split layout: list on the left, form on the right
- Configure name, NPM package, base URL, API key (masked by default)
- Manage model entries (add/remove)

### Skills management

- Manage project-local Cursor skills under `.cursor/skills/`
- Create skills and edit safe top-level text files in Tauri desktop mode
- Use browser mode as a preview workspace backed by `localStorage`

### Snapshots (sidebar)

- Save the current configuration as a timestamped snapshot
- Restore a snapshot (with confirmation)
- Export a snapshot as a JSON file

### Version check

- Top bar shows the current **oh-my-openagent** npm plugin version (from `opencode.json` `plugin` entries)
- One-click check for the latest npm version; when an update exists, bump the version in config in one step

## Config file locations

| File | Path |
|------|------|
| opencode.json | `~/.config/opencode/opencode.json` |
| oh-my agent config | `~/.config/opencode/oh-my-openagent.json` |
| Snapshots | `~/.config/opencode/.snapshots/` |
| Project skills | `<project-root>/.cursor/skills/` |

**Oh-my config (agents / categories):** The app reads **`oh-my-openagent.json` first**, then falls back to **`oh-my-opencode.json`** in the same directory if the new file is missing. Saves always go to **`oh-my-openagent.json`**. Snapshots include both filenames when present, plus `opencode.json`.
