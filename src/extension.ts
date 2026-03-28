import * as vscode from 'vscode';
import * as path from 'path';
import { initLog, log } from './log';
import { getFolderEmoji } from './colors';
import { initPanes, applyLayout, getColumnForFolder, ensurePaneForFolder, getActivePaneCount, getActiveFolderIndices, setActiveFolderIndices, setPrimaryPaneIndex, getPrimaryPaneIndex, isLazy } from './layout';
import { focusTerminalForFolder, initTerminals, disposeAllTerminals } from './terminals';
import { enableTabColors, disableTabColors, enablePaneTinting, disablePaneTinting, applyCustomTabLabels, clearCustomTabLabels, refreshDecorations } from './decorations';
import { initRouting, sortAllOpenTabs, startListening, stopListening, getIsMoving } from './routing';

let context: vscode.ExtensionContext;
let isEnabled = true;
let statusBarItem: vscode.StatusBarItem;
let primaryDebounceTimer: ReturnType<typeof setTimeout> | undefined;

function updateStatusBar() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) { statusBarItem.hide(); return; }

    const editor = vscode.window.activeTextEditor;
    let currentFolder: vscode.WorkspaceFolder | undefined;
    if (editor) { currentFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri); }

    const tabCounts = new Map<number, number>();
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputText) {
                const folder = vscode.workspace.getWorkspaceFolder(tab.input.uri);
                if (folder) { tabCounts.set(folder.index, (tabCounts.get(folder.index) || 0) + 1); }
            }
        }
    }

    if (currentFolder) {
        const tabCount = tabCounts.get(currentFolder.index) || 0;
        const emoji = getFolderEmoji(currentFolder.index);
        statusBarItem.text = `${emoji} ${currentFolder.name} $(file) ${tabCount}`;
    } else {
        statusBarItem.text = isEnabled ? '$(split-horizontal) Pane Mgr' : '$(split-horizontal) Pane Mgr: OFF';
    }

    const tooltipLines = ['Multi-Root Pane Manager (click to jump)'];
    for (const folder of folders) {
        const count = tabCounts.get(folder.index) || 0;
        const col = getColumnForFolder(folder.index);
        const emoji = getFolderEmoji(folder.index);
        tooltipLines.push(`  ${emoji} ${folder.name}: ${count} tabs (${col === -1 ? 'no pane' : `Pane ${col}`})`);
    }
    statusBarItem.tooltip = tooltipLines.join('\n');
    statusBarItem.backgroundColor = isEnabled ? undefined : new vscode.ThemeColor('statusBarItem.warningBackground');
}

function focusPane(paneNumber: number) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || paneNumber < 1 || paneNumber > folders.length) { return; }

    for (const group of vscode.window.tabGroups.all) {
        if (group.viewColumn === paneNumber && group.tabs.length > 0) {
            const firstTab = group.tabs[0];
            if (firstTab.input instanceof vscode.TabInputText) {
                vscode.commands.executeCommand('vscode.open', firstTab.input.uri, { viewColumn: paneNumber, preserveFocus: false });
                const folder = folders.find(f => f.index + 1 === paneNumber);
                if (folder) { focusTerminalForFolder(folder); }
                log(`Focused pane ${paneNumber}`);
                return;
            }
        }
    }
    vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    log(`Pane ${paneNumber} has no tabs`);
}

function cyclePane(direction: number) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) { return; }
    const current = vscode.window.activeTextEditor?.viewColumn || 1;
    let next = current + direction;
    if (next < 1) { next = folders.length; }
    else if (next > folders.length) { next = 1; }
    focusPane(next);
}

function debouncedPrimarySwitch(folderIndex: number, folderName: string) {
    if (primaryDebounceTimer) { clearTimeout(primaryDebounceTimer); }
    primaryDebounceTimer = setTimeout(() => {
        const col = getColumnForFolder(folderIndex);
        if (col === -1) { return; }
        const newPrimary = col - 1;
        if (newPrimary !== getPrimaryPaneIndex()) {
            setPrimaryPaneIndex(newPrimary);
            log(`Primary pane switched to ${newPrimary} (${folderName})`);
            applyLayout(getActivePaneCount()).catch(err => log(`Dynamic primary layout failed: ${err}`));
        }
    }, 300);
}

function waitForEditorGroups(expected: number, timeoutMs = 3000): Promise<void> {
    if (vscode.window.tabGroups.all.length >= expected) { return Promise.resolve(); }
    return new Promise(resolve => {
        const start = Date.now();
        const interval = setInterval(() => {
            if (vscode.window.tabGroups.all.length >= expected || Date.now() - start > timeoutMs) {
                clearInterval(interval);
                log(`Editor groups ready: ${vscode.window.tabGroups.all.length}/${expected} (${Date.now() - start}ms)`);
                resolve();
            }
        }, 50);
    });
}

function waitForTabsStable(timeoutMs = 5000): Promise<void> {
    return new Promise(resolve => {
        let lastCount = 0;
        let stableTime = 0;
        const start = Date.now();
        const interval = setInterval(() => {
            let count = 0;
            for (const g of vscode.window.tabGroups.all) { count += g.tabs.length; }
            if (count === lastCount) {
                stableTime += 100;
            } else {
                stableTime = 0;
                lastCount = count;
            }
            if (stableTime >= 300 || Date.now() - start > timeoutMs) {
                clearInterval(interval);
                log(`Tabs stable: ${count} total (${Date.now() - start}ms)`);
                resolve();
            }
        }, 100);
    });
}

function persistActiveFolders() {
    context.workspaceState.update('activeFolderIndices', getActiveFolderIndices());
}

function restoreActiveFolders(): number[] {
    return context.workspaceState.get<number[]>('activeFolderIndices', []);
}

export function activate(ctx: vscode.ExtensionContext) {
    context = ctx;
    initLog(ctx);
    initRouting(ctx);

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) {
        log(`Skipping activation: ${folders?.length ?? 0} workspace folder(s)`);
        return;
    }

    log(`Activated with ${folders.length} folders:`);
    for (const f of folders) { log(`  [${f.index}] ${f.name} → col ${f.index + 1}`); }

    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    isEnabled = config.get('enabled', true);
    initPanes(config.get('lazyPanes', true));

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'multiRootPaneManager.showFolderQuickPick';
    ctx.subscriptions.push(statusBarItem);
    updateStatusBar();
    statusBarItem.show();

    // Active editor tracking — debounced primary switch
    ctx.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor || !isEnabled || getIsMoving()) { return; }
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (folder) {
                focusTerminalForFolder(folder);
                const mode = config.get<string>('layout', 'primary-focus');
                if (mode === 'primary-focus') {
                    debouncedPrimarySwitch(folder.index, folder.name);
                }
            }
        })
    );

    // Workspace folder add/remove
    ctx.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(e => {
            log(`Workspace folders changed: +${e.added.length} -${e.removed.length}`);
            const newFolders = vscode.workspace.workspaceFolders;
            if (!newFolders || newFolders.length < 2) { return; }
            // Re-apply decorations and labels
            refreshDecorations();
            applyCustomTabLabels();
            // Re-init terminals for new folders
            for (const added of e.added) { focusTerminalForFolder(added); }
            // Re-layout
            if (isEnabled) {
                applyLayout(getActivePaneCount())
                    .then(() => sortAllOpenTabs())
                    .catch(err => log(`Folder change layout failed: ${err}`));
            }
        })
    );

    // Prevent empty group collapse
    const editorConfig = vscode.workspace.getConfiguration('workbench.editor');
    if (editorConfig.get('closeEmptyGroups') !== false) {
        editorConfig.update('closeEmptyGroups', false, vscode.ConfigurationTarget.Workspace);
    }

    // Decorations (non-label visuals are safe to apply early)
    try { if (config.get('colorTabs', true)) { enableTabColors(); } } catch (err) { log(`Tab color init failed: ${err}`); }
    try { if (config.get('colorPanes', true)) { enablePaneTinting(); } } catch (err) { log(`Pane tinting init failed: ${err}`); }

    // Layout + sort + labels (sequenced: layout → wait for groups → sort → labels → listen)
    if (isEnabled) {
        const sortOnStartup = config.get('sortOnStartup', true);

        const initSequence = async () => {
            let paneCount: number;

            if (isLazy()) {
                const persisted = restoreActiveFolders();
                const indices = getActiveFolderIndices();
                for (const i of persisted) {
                    if (i < folders.length && indices.indexOf(i) === -1) { indices.push(i); }
                }
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (tab.input instanceof vscode.TabInputText) {
                            const root = vscode.workspace.getWorkspaceFolder(tab.input.uri);
                            if (root && indices.indexOf(root.index) === -1) { indices.push(root.index); }
                        }
                    }
                }
                indices.sort((a, b) => a - b);
                paneCount = Math.max(indices.length, 1);
                log(`Lazy panes: ${indices.length} folder(s) have open files`);
            } else {
                paneCount = folders.length;
            }

            await applyLayout(paneCount);
            await waitForEditorGroups(paneCount);
            await waitForTabsStable();

            // Re-evaluate active folders based on actual tabs after VS Code finishes restoring
            if (isLazy()) {
                const actualIndices: number[] = [];
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (tab.input instanceof vscode.TabInputText) {
                            const root = vscode.workspace.getWorkspaceFolder(tab.input.uri);
                            if (root && actualIndices.indexOf(root.index) === -1) { actualIndices.push(root.index); }
                        }
                    }
                }
                actualIndices.sort((a, b) => a - b);
                const indices = getActiveFolderIndices();
                if (actualIndices.length < indices.length) {
                    setActiveFolderIndices(actualIndices);
                    paneCount = Math.max(actualIndices.length, 1);
                    log(`Lazy panes: shrunk to ${actualIndices.length} after tab restore`);
                    await applyLayout(paneCount);
                    await waitForEditorGroups(paneCount);
                }
            }

            if (sortOnStartup) { await sortAllOpenTabs(); }
            if (isLazy()) { persistActiveFolders(); }

            applyCustomTabLabels();
            startListening(isEnabled, updateStatusBar);
        };

        initSequence().catch(err => log(`Layout/sort failed: ${err}`));
    } else {
        applyCustomTabLabels();
    }

    // Terminals
    initTerminals(folders);

    // Welcome
    setTimeout(async () => {
        if (!config.get('showWelcome', true)) { return; }
        if (ctx.globalState.get('hasShownWelcome', false)) { return; }
        const result = await vscode.window.showInformationMessage(
            'Multi-Root Pane Manager: Each workspace folder now has its own pane.',
            'Got it!', 'Settings', "Don't show again"
        );
        if (result === 'Settings') { vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ShaneMain.multi-root-pane-manager'); }
        else if (result === "Don't show again") { config.update('showWelcome', false, vscode.ConfigurationTarget.Global); }
        ctx.globalState.update('hasShownWelcome', true);
    }, 1000);

    // Commands
    ctx.subscriptions.push(
        vscode.commands.registerCommand('multiRootPaneManager.toggle', () => {
            isEnabled = !isEnabled;
            updateStatusBar();
            if (isEnabled) {
                applyLayout(getActivePaneCount()).then(() => sortAllOpenTabs()).catch(err => log(`Toggle failed: ${err}`));
                startListening(isEnabled, updateStatusBar);
                applyCustomTabLabels();
                vscode.window.showInformationMessage('Pane Manager: ON');
            } else {
                stopListening();
                clearCustomTabLabels();
                vscode.window.showInformationMessage('Pane Manager: OFF');
            }
        }),
        vscode.commands.registerCommand('multiRootPaneManager.reset', () => {
            applyLayout(getActivePaneCount()).then(() => sortAllOpenTabs()).catch(err => log(`Reset failed: ${err}`));
            vscode.window.showInformationMessage('Pane Manager: Layout reset');
        }),
        vscode.commands.registerCommand('multiRootPaneManager.sortTabs', async () => {
            try { await sortAllOpenTabs(); vscode.window.showInformationMessage('Pane Manager: Tabs sorted'); }
            catch (err) { log(`Manual sort failed: ${err}`); vscode.window.showErrorMessage('Pane Manager: Sort failed'); }
        }),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane1', () => focusPane(1)),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane2', () => focusPane(2)),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane3', () => focusPane(3)),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane4', () => focusPane(4)),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane5', () => focusPane(5)),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane6', () => focusPane(6)),
        vscode.commands.registerCommand('multiRootPaneManager.cyclePaneLeft', () => cyclePane(-1)),
        vscode.commands.registerCommand('multiRootPaneManager.cyclePaneRight', () => cyclePane(1)),
        vscode.commands.registerCommand('multiRootPaneManager.openInCorrectPane', async (uri: vscode.Uri) => {
            if (!uri) { return; }
            const folder = vscode.workspace.getWorkspaceFolder(uri);
            if (!folder) { return; }
            const col = await ensurePaneForFolder(folder.index);
            await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: col, preview: false });
        }),
        vscode.commands.registerCommand('multiRootPaneManager.newFileInActiveFolder', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (!folder) { return; }
            const relativePath = await vscode.window.showInputBox({ prompt: `New file in ${folder.name}`, placeHolder: 'path/to/file.ext' });
            if (!relativePath) { return; }
            const newUri = vscode.Uri.file(path.join(folder.uri.fsPath, relativePath));
            await vscode.workspace.fs.writeFile(newUri, new Uint8Array());
            const col = await ensurePaneForFolder(folder.index);
            await vscode.commands.executeCommand('vscode.open', newUri, { viewColumn: col, preview: false });
        }),
        vscode.commands.registerCommand('multiRootPaneManager.showFolderQuickPick', async () => {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length < 2) { return; }
            const items = folders
                .filter(f => !isLazy() || getActiveFolderIndices().indexOf(f.index) !== -1)
                .map(f => ({ label: `$(folder) ${f.name}`, description: `Pane ${getColumnForFolder(f.index)}`, folder: f }));
            const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Jump to workspace folder pane' });
            if (selected) { const col = getColumnForFolder(selected.folder.index); if (col !== -1) { focusPane(col); } }
        })
    );

    // Config changes
    ctx.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('multiRootPaneManager.enabled')) {
                const newEnabled = vscode.workspace.getConfiguration('multiRootPaneManager').get('enabled', true);
                if (newEnabled !== isEnabled) {
                    isEnabled = newEnabled;
                    if (isEnabled) {
                        applyLayout(getActivePaneCount()).then(() => sortAllOpenTabs()).catch(err => log(`Config enable failed: ${err}`));
                        startListening(isEnabled, updateStatusBar);
                    } else { stopListening(); }
                    updateStatusBar();
                }
            }
            if (e.affectsConfiguration('multiRootPaneManager.layout')) {
                if (isEnabled) { applyLayout(getActivePaneCount()).then(() => sortAllOpenTabs()).catch(err => log(`Layout change failed: ${err}`)); }
            }
            if (e.affectsConfiguration('multiRootPaneManager.colorTabs')) {
                vscode.workspace.getConfiguration('multiRootPaneManager').get('colorTabs', true) ? enableTabColors() : disableTabColors();
            }
            if (e.affectsConfiguration('multiRootPaneManager.colorPanes')) {
                vscode.workspace.getConfiguration('multiRootPaneManager').get('colorPanes', true) ? enablePaneTinting() : disablePaneTinting();
            }
            if (e.affectsConfiguration('multiRootPaneManager.lazyPanes')) {
                initPanes(vscode.workspace.getConfiguration('multiRootPaneManager').get('lazyPanes', true));
                if (isEnabled) { applyLayout(getActivePaneCount()).then(() => sortAllOpenTabs()).catch(err => log(`LazyPanes change failed: ${err}`)); }
            }
            if (e.affectsConfiguration('multiRootPaneManager.tabLabelFormat')) {
                applyCustomTabLabels();
            }
            if (e.affectsConfiguration('multiRootPaneManager.colorTerminals') || e.affectsConfiguration('multiRootPaneManager.terminalLayout') || e.affectsConfiguration('multiRootPaneManager.eagerTerminals')) {
                const folders = vscode.workspace.workspaceFolders;
                if (folders && folders.length >= 2) {
                    disposeAllTerminals();
                    initTerminals(folders);
                }
            }
        })
    );
}

export function deactivate() {
    if (primaryDebounceTimer) { clearTimeout(primaryDebounceTimer); }
    stopListening();
    disableTabColors();
    disablePaneTinting();
    clearCustomTabLabels();
    // Restore closeEmptyGroups to default
    const editorConfig = vscode.workspace.getConfiguration('workbench.editor');
    editorConfig.update('closeEmptyGroups', undefined, vscode.ConfigurationTarget.Workspace);
    persistActiveFolders();
}
