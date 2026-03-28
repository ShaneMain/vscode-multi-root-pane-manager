import * as vscode from 'vscode';
import { log } from './log';
import { getFolderColor } from './colors';

const terminalMap = new Map<string, vscode.Terminal>();

function isTerminalAlive(t: vscode.Terminal): boolean {
    return t.exitStatus === undefined && vscode.window.terminals.indexOf(t) !== -1;
}

function findLiveSplitParent(): vscode.Terminal | undefined {
    for (const t of terminalMap.values()) {
        if (isTerminalAlive(t)) { return t; }
    }
    return undefined;
}

function getOrCreateTerminal(folder: vscode.WorkspaceFolder, split: boolean): vscode.Terminal {
    let terminal = terminalMap.get(folder.name);

    if (terminal && !isTerminalAlive(terminal)) {
        terminalMap.delete(folder.name);
        terminal = undefined;
    }

    // Adopt inherited terminal by name
    if (!terminal) {
        const existing = vscode.window.terminals.find(t =>
            t.exitStatus === undefined && t.name === folder.name
        );
        if (existing) {
            log(`Adopted inherited terminal "${folder.name}"`);
            terminal = existing;
            terminalMap.set(folder.name, terminal);
            return terminal;
        }
    }

    if (!terminal) {
        const color = getFolderColor(folder.index);
        const parent = split ? findLiveSplitParent() : undefined;
        if (parent) {
            terminal = vscode.window.createTerminal({
                name: folder.name,
                cwd: folder.uri,
                color,
                location: { parentTerminal: parent }
            });
        } else {
            terminal = vscode.window.createTerminal({
                name: folder.name,
                cwd: folder.uri,
                color
            });
        }
        terminalMap.set(folder.name, terminal);
        log(`Created terminal "${folder.name}"${parent ? ' (split)' : ''}`);
    }

    return terminal;
}

export function focusTerminalForFolder(folder: vscode.WorkspaceFolder) {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    if (!config.get('colorTerminals', true)) { return; }

    const split = config.get<string>('terminalLayout', 'tabs') === 'split';
    const terminal = getOrCreateTerminal(folder, split);
    terminal.show(true);
}

export function initTerminals(folders: readonly vscode.WorkspaceFolder[]) {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    if (!config.get('eagerTerminals', true) || !config.get('colorTerminals', true)) { return; }

    const split = config.get<string>('terminalLayout', 'tabs') === 'split';
    for (const folder of folders) {
        getOrCreateTerminal(folder, split);
    }
    const first = terminalMap.get(folders[0].name);
    if (first) { first.show(true); }
}

export function disposeAllTerminals() {
    for (const t of terminalMap.values()) { if (t.exitStatus === undefined) { t.dispose(); } }
    terminalMap.clear();
}
