# Multi-Root Pane Manager

A VS Code extension that automatically organizes multi-root workspaces: each workspace folder gets its own editor pane, color-coded tabs, and a dedicated terminal.

## Features

- **Automatic Layout** -- On activation, splits the editor into a balanced grid matching the number of workspace folders. Two folders get side-by-side panes; three or more get a two-row grid with the larger row on top.
- **Tab Routing** -- Files automatically open in the pane assigned to their workspace folder. Open a file from any folder and it lands in the right place.
- **Tab Pinning** -- Single-clicked files are promoted from preview to permanent tabs so they don't replace each other.
- **Color-Coded Tabs** -- Clean files are tinted with their folder's color in the editor tabs and explorer. Files with git status (modified, staged, untracked) keep their git decoration colors instead.
- **Color-Coded Terminals** -- Creates a split terminal for each workspace folder on startup, color-matched to the tab decorations.
- **Displaced Preview Restoration** -- When a file opens as a preview in the wrong pane (replacing an existing preview), the extension restores the original preview after moving the file.

## Layout Modes

**Grid (default)** -- Balanced two-row layout:

```
2 folders: | F1 | F2 |
3 folders: | F1 | F2 | / | F3 |
4 folders: | F1 | F2 | / | F3 | F4 |
5 folders: | F1 | F2 | F3 | / | F4 | F5 |
```

**All-right** -- Linear horizontal split:

```
| F1 | F2 | F3 | F4 |
```

## Commands

- `Multi-Root Pane Manager: Toggle` -- Enable/disable tab routing and layout
- `Multi-Root Pane Manager: Reset Pane Assignments` -- Re-apply the editor layout

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `multiRootPaneManager.enabled` | `true` | Enable/disable automatic pane management |
| `multiRootPaneManager.layout` | `"grid"` | Layout mode: `"grid"` or `"all-right"` |
| `multiRootPaneManager.colorTabs` | `true` | Color-code editor tabs and explorer items by workspace folder |
| `multiRootPaneManager.colorTerminals` | `true` | Create color-coded split terminals for each workspace folder on startup |

## Status Bar

Click **Pane Mgr: ON/OFF** in the status bar to toggle the extension.

## Diagnostics

Open the **Output** panel and select **Pane Manager** from the dropdown to see detailed logs of tab events, moves, and layout changes.

## Installation

### From VSIX

```sh
code --install-extension multi-root-pane-manager-1.1.0.vsix
```

### From Source

```sh
git clone https://github.com/ShaneMain/vscode-multi-root-pane-manager.git
cd vscode-multi-root-pane-manager
npm install
npm run compile
npx vsce package
```

## Requirements

- VS Code 1.75.0 or higher
- A multi-root workspace (2+ folders)

## License

MIT
