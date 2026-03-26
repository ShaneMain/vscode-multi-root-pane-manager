import * as vscode from 'vscode';
import { log } from './log';
import { getFolderEmoji } from './colors';
import { getColumnForFolder } from './layout';

let decorationDisposable: vscode.Disposable | undefined;

function resolveFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) { return undefined; }

    // Standard lookup — works for files and subdirs inside workspace folders
    let folder = vscode.workspace.getWorkspaceFolder(uri);

    // Fallback for workspace root URIs (some VS Code versions miss these)
    if (!folder) {
        const uriStr = uri.toString().replace(/\/$/, '');
        folder = folders.find(f => f.uri.toString().replace(/\/$/, '') === uriStr);
    }

    return folder;
}

class FolderColorDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChange.event;

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        // Skip non-file schemes
        if (uri.scheme !== 'file') { return undefined; }

        const folder = resolveFolder(uri);
        if (!folder) {
            log(`DECO no-folder: ${uri.fsPath}`);
            return undefined;
        }

        const emoji = getFolderEmoji(folder.index);
        const col = getColumnForFolder(folder.index);
        const name = uri.path.split('/').pop();
        const tooltip = `${emoji} ${folder.name} (Pane ${col !== -1 ? col : '?'})`;

        log(`DECO: "${name}" path=${uri.fsPath} → folder[${folder.index}] ${folder.name} → ${emoji}`);

        const decoration = new vscode.FileDecoration(emoji, tooltip);
        decoration.propagate = false;
        return decoration;
    }

    refresh() { this._onDidChange.fire(undefined); }
    dispose() {}
}

let decorationProvider: FolderColorDecorationProvider | undefined;

export function enableTabColors() {
    if (decorationDisposable) { return; }
    decorationProvider = new FolderColorDecorationProvider();
    decorationDisposable = vscode.window.registerFileDecorationProvider(decorationProvider);
    log('Tab color coding enabled');
}

export function disableTabColors() {
    decorationDisposable?.dispose();
    decorationDisposable = undefined;
    decorationProvider = undefined;
    log('Tab color coding disabled');
}

export function refreshDecorations() {
    decorationProvider?.refresh();
}

// --- Custom tab labels ---

export type TabLabelFormat = 'emoji-dir-file' | 'emoji-file' | 'dir-file' | 'none';

export function applyCustomTabLabels() {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    const format = config.get<TabLabelFormat>('tabLabelFormat', 'none');
    if (format === 'none') {
        clearCustomTabLabels();
        return;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) { return; }

    const patterns: Record<string, string> = {};
    for (const folder of folders) {
        const emoji = getFolderEmoji(folder.index);
        const shortName = folder.name.length > 20
            ? folder.uri.fsPath.split('/').pop() || folder.name
            : folder.name;

        let template: string;
        switch (format) {
            case 'emoji-dir-file':
                template = `${emoji} ${shortName} / \${filename}.\${extname}`;
                break;
            case 'emoji-file':
                template = `${emoji} \${filename}.\${extname}`;
                break;
            case 'dir-file':
                template = `${shortName} / \${filename}.\${extname}`;
                break;
            default:
                return;
        }

        const folderPath = folder.uri.fsPath;
        patterns[`${folderPath}/**`] = template;
        patterns[`${folderPath}/*`] = template;
    }

    const labelConfig = vscode.workspace.getConfiguration('workbench.editor');
    const existing = labelConfig.get<Record<string, string>>('customLabels.patterns', {});
    const merged = { ...existing, ...patterns };

    if (JSON.stringify(existing) !== JSON.stringify(merged)) {
        labelConfig.update('customLabels.patterns', merged, vscode.ConfigurationTarget.Workspace);
        log(`Applied custom tab labels (format: ${format}) for ${folders.length} folders`);
    }
}

export function clearCustomTabLabels() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return; }

    const labelConfig = vscode.workspace.getConfiguration('workbench.editor');
    const existing = labelConfig.get<Record<string, string>>('customLabels.patterns', {});
    if (!existing || Object.keys(existing).length === 0) { return; }

    let changed = false;
    for (const folder of folders) {
        const p = folder.uri.fsPath;
        if (existing[`${p}/**`]) { delete existing[`${p}/**`]; changed = true; }
        if (existing[`${p}/*`]) { delete existing[`${p}/*`]; changed = true; }
    }

    if (changed) {
        labelConfig.update('customLabels.patterns',
            Object.keys(existing).length > 0 ? existing : undefined,
            vscode.ConfigurationTarget.Workspace);
        log('Cleared custom tab labels');
    }
}
