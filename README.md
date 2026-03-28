# Multi-Root Pane Manager

Automatically organizes multi-root workspaces so each folder gets its own editor pane, labeled tabs, dedicated terminals, and keyboard navigation. Every feature is independently configurable -- use it all out of the box, or turn off what you don't need.

## Features

### Pane Management

- **Automatic Layout** -- Opens each workspace folder in its own editor pane. Choose from three layout modes: primary-focus, grid, or all-right.
- **Smart Tab Routing** -- Files automatically open in their folder's pane. Single-clicked previews are pinned to prevent replacement. Exclude specific files or patterns from routing with glob rules.
- **Tab Sorting** -- Sorts all open tabs into their correct panes on startup and on demand
- **Sticky Tabs** -- Manually moved tabs stay where you put them and won't be auto-routed again. Toggle this per-workspace if needed.
- **Lazy Panes** -- Panes are created on demand as you open files, avoiding empty editor groups. Disable to pre-create all panes on startup.

### Tab Labels

Tabs are labeled to show which workspace folder they belong to. Pick the format that works for you:

| Format | Example |
|--------|---------|
| `emoji-dir-file` (default) | `🔵 backend / server.ts` |
| `emoji-file` | `🔵 server.ts` |
| `dir-file` | `backend / server.ts` |
| `none` | `server.ts` (VS Code default) |

Supply your own emoji per folder with `customEmoji` (e.g. `["🔴", "🔵", "🟢"]`), or leave it empty for the built-in palette.

### Visual Cues

- **Pane Tinting** -- Each editor pane gets a subtle background tint based on its workspace folder. Disable with `colorPanes`.
- **Explorer Badges** -- Files in the explorer show emoji badges by folder. Disable with `colorTabs`.

Both are on by default and can be toggled independently.

### Terminals

- **Auto-Switch** -- Switching panes automatically switches to that folder's terminal. Disable with `colorTerminals`.
- **Eager Creation** -- Creates a terminal for every workspace folder on startup, adopting existing ones. Disable with `eagerTerminals` if you prefer to create terminals manually.
- **Layout** -- Arrange folder terminals as separate **tabs** (default) or **split** side-by-side in one panel. Note: in split mode, if a terminal is closed and recreated it may reopen as a separate tab due to a VS Code API limitation.

### Navigation

- `Ctrl+Alt+1` through `Ctrl+Alt+6` -- Jump to pane 1-6
- `Ctrl+Alt+Left/Right` -- Cycle through panes
- `Ctrl+Alt+N` -- New file in the active folder
- **Status Bar** -- Shows current folder name and tab count. Click to jump to any folder's pane.

All keybindings are customizable via VS Code's keyboard shortcuts settings.

## Layout Modes

**Primary-focus** (default) -- First folder gets 70% width, others share 30%:
```
| F1 (70%) | F2 | F3 | (30%) |
```

**Grid** -- Balanced two-row layout:
```
2 folders: | F1 | F2 |
3 folders: | F1 | F2 | / | F3 |
4 folders: | F1 | F2 | / | F3 | F4 |
```

**All-right** -- Linear horizontal split:
```
| F1 | F2 | F3 | F4 |
```

## Commands

| Command | Description |
|---------|-------------|
| Toggle | Enable/disable pane management |
| Reset Pane Assignments | Re-apply layout and sort all tabs |
| Sort All Tabs | Move all open tabs to their correct panes |
| Focus Pane 1-6 | Jump to a specific pane |
| Cycle Pane Left/Right | Navigate between panes |
| Jump to Folder Pane | Quick-pick menu to select a folder |
| Open in Correct Pane | Right-click a file in explorer to open it in the right pane |
| New File in Active Folder | Create a file in the active pane's folder |

All commands are prefixed with `Multi-Root Pane Manager:` in the command palette.

## Settings

Everything is on by default. Turn off what you don't want.

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Master switch for pane management |
| `layout` | `"primary-focus"` | Layout mode: `"primary-focus"`, `"grid"`, or `"all-right"` |
| `lazyPanes` | `true` | Only create panes as files are opened. Set `false` to pre-create all panes. |
| `tabLabelFormat` | `"emoji-dir-file"` | Tab label format: `"emoji-dir-file"`, `"emoji-file"`, `"dir-file"`, or `"none"` |
| `colorPanes` | `true` | Subtle background tint on editor panes by folder |
| `colorTabs` | `true` | Emoji badges on files in the explorer |
| `customEmoji` | `[]` | Custom emoji per folder (e.g. `["🔴", "🔵", "🟢"]`). Empty uses defaults. |
| `colorTerminals` | `true` | Auto-switch terminal when changing panes |
| `eagerTerminals` | `true` | Create a terminal for every folder on startup |
| `terminalLayout` | `"tabs"` | Terminal arrangement: `"tabs"` or `"split"` |
| `excludePatterns` | `[]` | Glob patterns to skip auto-routing (e.g. `["**/.vscode/**"]`) |
| `sortOnStartup` | `true` | Sort tabs into correct panes on startup |
| `enableStickyTabs` | `true` | Remember manually moved tabs |
| `showWelcome` | `true` | Show welcome notification on first activation |

All settings are prefixed with `multiRootPaneManager.` in `settings.json`.

## Installation

Search for **Multi-Root Pane Manager** in the VS Code Extensions marketplace, or install from [Open VSX](https://open-vsx.org/extension/ShaneMain/multi-root-pane-manager).

### From Source

```sh
git clone https://github.com/ShaneMain/vscode-multi-root-pane-manager.git
cd vscode-multi-root-pane-manager
npm install && npm run compile
npx vsce package
code --install-extension multi-root-pane-manager-*.vsix
```

## Requirements

- VS Code 1.75.0+
- A multi-root workspace (2+ folders)

## Uninstalling

Before disabling or uninstalling, remove these from your `.code-workspace` or `.vscode/settings.json`:

```json
"workbench.editor.customLabels.patterns"
"workbench.editor.closeEmptyGroups"
```

VS Code does not reliably run extension cleanup on uninstall, so these settings may persist otherwise.

## Diagnostics

Open the **Output** panel and select **Pane Manager** to see logs for tab events, moves, layout changes, and navigation.

## License

MIT
