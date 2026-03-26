# Multi-Root Pane Manager

A powerful VS Code extension that transforms multi-root workspaces into organized, navigable environments. Each workspace folder gets its own editor pane, color-coded tabs, dedicated terminals, and smart keyboard navigation.

## Features

### Core Functionality

- **Automatic Layout** — Splits the editor into layouts matching your workspace folders:
  - **Grid** (default): Balanced two-row layout
  - **All-right**: Linear horizontal split
  - **Primary-focus**: First folder gets 70% width, others split the remaining 30%

- **Smart Tab Routing** — Files automatically open in their folder's pane. Single-clicked previews are pinned to prevent replacement.

- **Automatic Tab Sorting** — On startup and when enabled, all open tabs are sorted into correct panes.

- **Sticky Tabs** — Manually moved tabs stay put. The extension remembers your manual placements and won't auto-route them.

### Navigation

- **Keyboard Shortcuts**:
  - `Ctrl+Alt+1/2/3/4/5/6` — Jump directly to pane 1-6
  - `Ctrl+Alt+Left/Right` — Cycle through panes
  - `Ctrl+Alt+N` — New file in active folder

- **Enhanced Status Bar** — Shows current folder name, tab counts, and click to jump between panes.

- **Terminal Focus Sync** — Automatically focuses the corresponding terminal when switching panes (optional).

### Customization

- **Color-Coded Tabs** — Clean files are tinted by folder color in tabs and explorer. Git-modified files keep their git decorations. Fully optional.

- **Custom Color Palette** — Define your own hex colors for folders instead of using terminal ANSI colors.

- **Exclude Patterns** — Skip auto-routing for workspace-level files like `.vscode/**` or `README.md`.

- **Color-Coded Terminals** — Split terminals created for each folder on startup, color-matched to tabs. Optional.

## Layout Modes

**Grid (default)** — Balanced two-row layout:
```
2 folders: | F1 | F2 |
3 folders: | F1 | F2 | / | F3 |
4 folders: | F1 | F2 | / | F3 | F4 |
5 folders: | F1 | F2 | F3 | / | F4 | F5 |
```

**All-right** — Linear horizontal split:
```
| F1 | F2 | F3 | F4 |
```

**Primary-focus** — First folder dominates:
```
| F1 (70%) | F2 | F3 | (30%) |
```

## Commands

### Core Commands
- `Multi-Root Pane Manager: Toggle` — Enable/disable pane management
- `Multi-Root Pane Manager: Reset Pane Assignments` — Re-apply layout and sort all tabs
- `Multi-Root Pane Manager: Sort All Tabs` — Manually sort all open tabs

### Navigation Commands
- `Multi-Root Pane Manager: Focus Pane 1-6` — Jump to specific pane (bound to `Ctrl+Alt+1-6`)
- `Multi-Root Pane Manager: Cycle Pane Left/Right` — Navigate between panes (bound to `Ctrl+Alt+Left/Right`)
- `Multi-Root Pane Manager: Jump to Folder Pane` — Quick-pick menu to select folder (status bar click)

### Utility Commands
- `Multi-Root Pane Manager: Open in Correct Pane` — Right-click file in explorer to open in its folder's pane
- `Multi-Root Pane Manager: New File in Active Folder` — Create file in active pane's folder (bound to `Ctrl+Alt+N`)

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `multiRootPaneManager.enabled` | `true` | Enable/disable automatic pane management |
| `multiRootPaneManager.layout` | `"grid"` | Layout mode: `"grid"`, `"all-right"`, or `"primary-focus"` |
| `multiRootPaneManager.colorTabs` | `true` | Color-code editor tabs and explorer items by workspace folder |
| `multiRootPaneManager.colorTerminals` | `true` | Create color-coded split terminals for each workspace folder on startup |
| `multiRootPaneManager.customColors` | `[]` | Custom hex colors for folders, e.g., `["#FF6B6B", "#4ECDC4"]`. Empty = use default terminal colors |
| `multiRootPaneManager.excludePatterns` | `[]` | Glob patterns for files to skip auto-routing, e.g., `["**/.vscode/**", "**/README.md"]` |
| `multiRootPaneManager.focusTerminalOnSwitch` | `true` | Automatically focus corresponding terminal when switching panes |
| `multiRootPaneManager.sortOnStartup` | `true` | Automatically sort tabs when VS Code starts |
| `multiRootPaneManager.enableStickyTabs` | `true` | Remember manually moved tabs and prevent auto-routing them |
| `multiRootPaneManager.showWelcome` | `true` | Show welcome notification on first activation |

## Keybindings

| Key | Command |
|-----|---------|
| `Ctrl+Alt+1` through `Ctrl+Alt+6` | Focus pane 1-6 |
| `Ctrl+Alt+Left` | Cycle to previous pane |
| `Ctrl+Alt+Right` | Cycle to next pane |
| `Ctrl+Alt+N` | New file in active folder |

All keybindings are customizable via VS Code's keyboard shortcuts settings.

## Status Bar

The status bar shows:
- Current workspace folder name and tab count (e.g., `📁 frontend 📄 5`)
- Click to open quick-pick menu to jump to any folder's pane
- Tooltip shows tab counts for all folders

## Diagnostics

Open the **Output** panel and select **Pane Manager** from the dropdown to see detailed logs of tab events, moves, layout changes, and navigation actions.

## Installation

### From Marketplace
Search for "Multi-Root Pane Manager" in VS Code Extensions.

### From VSIX
```sh
code --install-extension multi-root-pane-manager-1.3.0.vsix
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

## Tips

- **First Time Setup**: On first activation, the extension shows a welcome message with quick tips.
- **Manually Moving Tabs**: If you drag a tab to a different pane, it becomes "sticky" and won't be auto-routed again (if `enableStickyTabs` is enabled).
- **Workspace-Level Files**: Use `excludePatterns` for files that belong to the whole workspace rather than a specific folder.
- **Custom Workflows**: Combine keyboard shortcuts with exclude patterns and sticky tabs for maximum flexibility.

## License

MIT
