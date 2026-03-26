import * as vscode from 'vscode';
import { log, dumpTabGroups } from './log';
import { getColumnForFolder, ensurePaneForFolder, isLazy, getActiveFolderIndices, setActiveFolderIndices, applyLayout } from './layout';

let isMoving = false;
let prevPreviews: Map<number, string> = new Map();
let tabDisposable: vscode.Disposable | undefined;
let context: vscode.ExtensionContext;
let stickyTabs = new Set<string>();

export function initRouting(ctx: vscode.ExtensionContext) {
    context = ctx;
    const saved = ctx.workspaceState.get<string[]>('stickyTabs', []);
    stickyTabs = new Set(saved);
}

export function getIsMoving() { return isMoving; }

function isStickyTab(uri: vscode.Uri): boolean {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    if (!config.get('enableStickyTabs', true)) { return false; }
    return stickyTabs.has(uri.toString());
}

function isExcluded(uri: vscode.Uri): boolean {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    const patterns = config.get<string[]>('excludePatterns', []);
    if (patterns.length === 0) { return false; }

    const relativePath = vscode.workspace.asRelativePath(uri, false);
    return patterns.some(pattern => {
        const regexPattern = pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '.');
        return new RegExp(`^${regexPattern}$`).test(relativePath);
    });
}

function snapshotPreviews(): Map<number, string> {
    const snap = new Map<number, string>();
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.isPreview && tab.input instanceof vscode.TabInputText) {
                snap.set(group.viewColumn, tab.input.uri.toString());
            }
        }
    }
    return snap;
}

async function moveTab(uri: vscode.Uri, sourceColumn: number, targetColumn: vscode.ViewColumn, displacedPreviewUri?: string) {
    const fileName = uri.path.split('/').pop();
    isMoving = true;
    try {
        let freshTab: vscode.Tab | undefined;
        for (const group of vscode.window.tabGroups.all) {
            if (group.viewColumn === sourceColumn) {
                freshTab = group.tabs.find(t =>
                    t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString()
                );
                break;
            }
        }

        if (freshTab) {
            log(`    close "${fileName}" in col ${sourceColumn}...`);
            await vscode.window.tabGroups.close(freshTab);
            log(`    close done`);
        } else {
            log(`    tab "${fileName}" already gone from col ${sourceColumn}, skipping close`);
        }

        if (displacedPreviewUri) {
            const restoredUri = vscode.Uri.parse(displacedPreviewUri);
            log(`    restoring displaced preview in col ${sourceColumn}...`);
            await vscode.commands.executeCommand('vscode.open', restoredUri, { viewColumn: sourceColumn, preview: true });
            log(`    restore done`);
        }

        log(`    open "${fileName}" in col ${targetColumn} (preview: false)...`);
        await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: targetColumn, preview: false });
        log(`    open done`);
    } catch (err) {
        log(`    ERROR: ${err}`);
    } finally {
        isMoving = false;
        log(`    isMoving reset to false`);
    }
}

async function pinTab(uri: vscode.Uri, column: number) {
    isMoving = true;
    try {
        await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: column, preview: false });
        log(`    pin done`);
    } catch (err) {
        log(`    PIN ERROR: ${err}`);
    } finally {
        isMoving = false;
    }
}

export async function onTabsChanged(event: vscode.TabChangeEvent, isEnabled: boolean, updateStatusBar: () => void) {
    if (!isEnabled || isMoving) {
        if (isMoving && event.opened.length > 0) {
            log(`EVENT SKIPPED (isMoving=true) — ${event.opened.length} opened, ${event.changed.length} changed, ${event.closed.length} closed`);
        }
        return;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) {
        prevPreviews = snapshotPreviews();
        return;
    }

    if (event.opened.length === 0) {
        if (isLazy() && event.closed.length > 0) {
            const foldersWithTabs = new Set<number>();
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    if (tab.input instanceof vscode.TabInputText) {
                        const root = vscode.workspace.getWorkspaceFolder(tab.input.uri);
                        if (root) { foldersWithTabs.add(root.index); }
                    }
                }
            }
            const indices = getActiveFolderIndices();
            const before = indices.length;
            const filtered = indices.filter(i => foldersWithTabs.has(i));
            if (filtered.length < before) {
                setActiveFolderIndices(filtered);
                if (filtered.length > 0) { await applyLayout(filtered.length); }
                log(`Lazy panes: shrunk to ${filtered.length} active folder(s)`);
            }
        }
        prevPreviews = snapshotPreviews();
        updateStatusBar();
        return;
    }

    log(`EVENT — opened: ${event.opened.length}, changed: ${event.changed.length}, closed: ${event.closed.length}`);

    const toProcess: Array<{ uri: vscode.Uri; column: number; isPreview: boolean }> = [];
    for (const tab of event.opened) {
        if (!(tab.input instanceof vscode.TabInputText)) { continue; }
        toProcess.push({ uri: tab.input.uri, column: tab.group.viewColumn, isPreview: tab.isPreview });
    }

    await new Promise(resolve => setTimeout(resolve, 50));
    dumpTabGroups('before processing');

    for (const { uri, column: eventColumn, isPreview } of toProcess) {
        const fileName = uri.path.split('/').pop();

        if (isExcluded(uri)) { log(`  SKIP ${fileName} — excluded`); continue; }
        if (isStickyTab(uri)) { log(`  SKIP ${fileName} — sticky`); continue; }

        const root = vscode.workspace.getWorkspaceFolder(uri);
        if (!root) { log(`  SKIP ${fileName} — no workspace folder`); continue; }

        const targetColumn = await ensurePaneForFolder(root.index);

        let currentColumn = eventColumn;
        for (const group of vscode.window.tabGroups.all) {
            if (group.tabs.some(t =>
                t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString()
            )) {
                currentColumn = group.viewColumn;
                break;
            }
        }

        log(`  TAB "${fileName}" — root: ${root.name}[${root.index}], current col: ${currentColumn}, target col: ${targetColumn}, preview: ${isPreview}`);

        if (currentColumn !== targetColumn) {
            let displacedPreviewUri: string | undefined;
            if (isPreview) {
                const prevUri = prevPreviews.get(currentColumn);
                if (prevUri && prevUri !== uri.toString()) { displacedPreviewUri = prevUri; }
            }
            log(`  → MOVING "${fileName}" from col ${currentColumn} to col ${targetColumn}`);
            await moveTab(uri, currentColumn, targetColumn, displacedPreviewUri);
            dumpTabGroups('after move');
        } else if (isPreview) {
            log(`  → PINNING "${fileName}" in col ${currentColumn} (was preview)`);
            await pinTab(uri, currentColumn);
        } else {
            log(`  → OK, already in correct column`);
        }
    }

    prevPreviews = snapshotPreviews();
    updateStatusBar();
}

export async function sortAllOpenTabs() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) { return; }

    log('Sorting all open tabs...');
    dumpTabGroups('before sorting');

    const toMove: Array<{ uri: vscode.Uri; sourceColumn: number; targetColumn: number }> = [];

    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (!(tab.input instanceof vscode.TabInputText)) { continue; }
            const uri = tab.input.uri;
            if (isExcluded(uri) || isStickyTab(uri)) { continue; }
            const root = vscode.workspace.getWorkspaceFolder(uri);
            if (!root) { continue; }
            const targetColumn = getColumnForFolder(root.index);
            if (targetColumn === -1 || group.viewColumn === targetColumn) { continue; }
            toMove.push({ uri, sourceColumn: group.viewColumn, targetColumn });
        }
    }

    if (toMove.length === 0) { log('No tabs need sorting'); return; }

    log(`Found ${toMove.length} tab(s) to sort`);
    isMoving = true;
    try {
        for (const { uri, sourceColumn, targetColumn } of toMove) {
            const fileName = uri.path.split('/').pop();
            log(`  Moving "${fileName}" from col ${sourceColumn} to col ${targetColumn}`);

            let freshTab: vscode.Tab | undefined;
            for (const group of vscode.window.tabGroups.all) {
                freshTab = group.tabs.find(t =>
                    t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString()
                );
                if (freshTab) { break; }
            }

            if (freshTab) {
                await vscode.window.tabGroups.close(freshTab);
            } else {
                log(`  Tab "${fileName}" already gone, skipping close`);
            }

            await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: targetColumn, preview: false });
        }
    } catch (err) {
        log(`ERROR sorting tabs: ${err}`);
    } finally {
        isMoving = false;
    }

    dumpTabGroups('after sorting');
    log('Tab sorting complete');
}

export function startListening(isEnabled: boolean, updateStatusBar: () => void) {
    if (tabDisposable) { return; }
    tabDisposable = vscode.window.tabGroups.onDidChangeTabs(e => onTabsChanged(e, isEnabled, updateStatusBar));
}

export function stopListening() {
    tabDisposable?.dispose();
    tabDisposable = undefined;
}
