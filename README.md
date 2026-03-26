# Multi-Root Pane Manager

A VS Code extension that automatically splits editor panes in multi-root workspaces and routes new tabs to specific panes.

## Features

- **Automatic Pane Splitting**: Automatically splits the editor when opening a multi-root workspace
- **Smart Tab Routing**: Routes newly opened tabs to a configured pane
- **Configurable**: Choose which pane to route tabs to and the split direction
- **Toggle On/Off**: Easily enable/disable the extension via status bar or command palette

## Usage

1. Open a multi-root workspace (File → Open Workspace from File...)
2. The extension will automatically split the editor pane
3. New tabs will automatically open in the configured pane (default: right pane)

### Commands

- `Multi-Root Pane Manager: Toggle Auto-Routing` - Enable/disable automatic tab routing
- `Multi-Root Pane Manager: Split Pane Now` - Manually trigger pane split

### Configuration

Access settings via File → Preferences → Settings, then search for "Multi-Root Pane Manager":

- `multiRootPaneManager.enabled` (default: `true`) - Enable/disable the extension
- `multiRootPaneManager.targetPaneIndex` (default: `1`) - The pane index where new tabs should open (0 = left, 1 = right)
- `multiRootPaneManager.splitDirection` (default: `"vertical"`) - Split direction: `"vertical"` or `"horizontal"`

### Status Bar

The extension adds a status bar item that shows the current state:
- Click it to toggle the extension on/off
- Green: Enabled
- Yellow: Disabled

## Installation

### From Source

1. Clone or download this repository
2. Open the folder in VS Code
3. Run `npm install`
4. Press F5 to open a new VS Code window with the extension loaded
5. To package: `npm install -g @vscode/vsce && vsce package`

### From VSIX

1. Package the extension: `vsce package`
2. Install: Code → Install from VSIX...

## Requirements

- VS Code 1.75.0 or higher

## How It Works

The extension:
1. Detects multi-root workspaces on activation
2. Automatically splits the editor into two panes (if not already split)
3. Monitors tab open events
4. Moves newly opened tabs to the configured target pane

## License

MIT
