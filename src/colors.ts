import * as vscode from 'vscode';

const FOLDER_EMOJI = ['🔵', '🟢', '🟡', '🟣', '🔴', '🟠'];

const TERMINAL_COLOR_IDS = [
    'terminal.ansiBlue',
    'terminal.ansiGreen',
    'terminal.ansiYellow',
    'terminal.ansiMagenta',
    'terminal.ansiRed',
    'terminal.ansiBrightYellow',
];

const PANE_TINT_COLORS = [
    'rgba(30, 100, 255, 0.045)',
    'rgba(30, 200, 30, 0.04)',
    'rgba(255, 200, 30, 0.035)',
    'rgba(180, 30, 255, 0.04)',
    'rgba(255, 30, 30, 0.04)',
    'rgba(255, 150, 30, 0.04)',
];

export function getFolderEmoji(index: number): string {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    const custom = config.get<string[]>('customEmoji', []);
    if (custom.length > 0) {
        return custom[index % custom.length];
    }
    return FOLDER_EMOJI[index % FOLDER_EMOJI.length];
}

export function getFolderColor(index: number): vscode.ThemeColor {
    return new vscode.ThemeColor(TERMINAL_COLOR_IDS[index % TERMINAL_COLOR_IDS.length]);
}

export function getPaneTintColor(index: number): string {
    return PANE_TINT_COLORS[index % PANE_TINT_COLORS.length];
}
