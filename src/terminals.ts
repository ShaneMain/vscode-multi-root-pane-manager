import * as vscode from 'vscode';
import { log } from './log';
import { getFolderColor } from './colors';

const terminalMap = new Map<string, vscode.Terminal>();
let firstTerminal: vscode.Terminal | undefined;

function isTerminalAlive(t: vscode.Terminal): boolean {
    return t.exitStatus === undefined && vscode.window.terminals.indexOf(t) !== -1;
}

function findLiveSplitParent(): vscode.Terminal | undefined {
    if (firstTerminal && isTerminalAlive(firstTerminal)) { return firstTerminal; }
    for (const t of terminalMap.values()) {
        if (isTerminalAlive(t)) { return t; }
    }
    return undefined;
}

function getOrCreateTerminal(folder: vscode.WorkspaceFolder, split: boolean): vscode.Terminal {
    // Check if we already have one
    let terminal = terminalMap.get(folder.name);

    if (terminal && !isTerminalAlive(terminal)) {
        terminalMap.delete(folder.name);
        terminal = undefined;
    }

    // Check for inherited terminals
    if (!terminal) {
        const existing = vscode.window.terminals.find(t =>
            t.exitStatus === undefined && t.name === folder.name
        );
        if (existing) {
            log(`Replacing inherited terminal "${folder.name}" with correctly colored one`);
            existing.dispose();
        }
    }

    // Create new
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
        if (!firstTerminal || firstTerminal.exitStatus !== undefined) {
            firstTerminal = terminal;
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

    // In split mode, if no live terminals exist, reinit all so the split layout is restored
    if (split && !findLiveSplitParent()) {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length >= 2) {
            for (const f of folders) { getOrCreateTerminal(f, split); }
            const terminal = terminalMap.get(folder.name);
            if (terminal) { terminal.show(true); }
            return;
        }
    }

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
    firstTerminal = undefined;
}

export function getTerminalMap() { return terminalMap; }
