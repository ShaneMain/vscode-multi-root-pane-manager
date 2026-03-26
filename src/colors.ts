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
