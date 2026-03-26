import * as vscode from 'vscode';

const LOG_PREFIX = '[PaneMgr]';
let outputChannel: vscode.OutputChannel;

function log(msg: string) {
    const ts = new Date().toISOString().slice(11, 23);
    outputChannel.appendLine(`${ts} ${LOG_PREFIX} ${msg}`);
}

function dumpTabGroups(label: string) {
    const groups = vscode.window.tabGroups.all;
    log(`  ${label} — ${groups.length} group(s):`);
    for (const g of groups) {
        const tabs = g.tabs.map(t => {
            const name = t.input instanceof vscode.TabInputText
                ? t.input.uri.path.split('/').pop()
                : '(non-text)';
            return `${name}${t.isPreview ? '(P)' : ''}`;
        });
        log(`    col ${g.viewColumn}: [${tabs.join(', ')}]`);
    }
}

// Color palette shared by tab decorations and terminal indicators
const FOLDER_COLOR_IDS = [
    'terminal.ansiBlue',
    'terminal.ansiGreen',
    'terminal.ansiYellow',
    'terminal.ansiMagenta',
    'terminal.ansiCyan',
    'terminal.ansiRed',
];

function getFolderColor(index: number): vscode.ThemeColor {
    return new vscode.ThemeColor(FOLDER_COLOR_IDS[index % FOLDER_COLOR_IDS.length]);
}

// FileDecorationProvider that colors tabs/explorer by workspace folder.
// Files with git status get badge only (no color) so git decorations show through.
class FolderColorDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChange.event;
    private gitChangedUris = new Set<string>();
    private gitDisposables: vscode.Disposable[] = [];

    constructor() {
        this.initGitWatcher();
    }

    private async initGitWatcher() {
        const gitExt = vscode.extensions.getExtension('vscode.git');
        if (!gitExt) { return; }
        if (!gitExt.isActive) { await gitExt.activate(); }

        const git = gitExt.exports.getAPI(1);

        const watchRepo = (repo: any) => {
            this.gitDisposables.push(
                repo.state.onDidChange(() => {
                    this.refreshGitStatus(git);
                    this._onDidChange.fire(undefined);
                })
            );
        };

        for (const repo of git.repositories) { watchRepo(repo); }
        git.onDidOpenRepository((repo: any) => watchRepo(repo));

        this.refreshGitStatus(git);
    }

    private refreshGitStatus(git: any) {
        this.gitChangedUris.clear();
        for (const repo of git.repositories) {
            const changes = [
                ...repo.state.workingTreeChanges,
                ...repo.state.indexChanges,
                ...repo.state.mergeChanges
            ];
            for (const c of changes) {
                this.gitChangedUris.add(c.uri.toString());
            }
        }
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) { return undefined; }
        const badge = folder.name.charAt(0).toUpperCase();

        // Git-affected files: badge only, no color — let git decorations show
        if (this.gitChangedUris.has(uri.toString())) {
            return new vscode.FileDecoration(badge, folder.name);
        }

        // Clean files: badge + folder color
        return new vscode.FileDecoration(badge, folder.name, getFolderColor(folder.index));
    }

    dispose() {
        this.gitDisposables.forEach(d => d.dispose());
    }
}

let isEnabled = true;
let isMoving = false;
let statusBarItem: vscode.StatusBarItem;
let tabDisposable: vscode.Disposable | undefined;
let decorationDisposable: vscode.Disposable | undefined;

// Builds the grid layout descriptor for vscode.setEditorLayout.
// 2: | 1 | 2 |
// 3: | 1 | 2 | / | 3 |
// 4: | 1 | 2 | / | 3 | 4 |
// 5: | 1 | 2 | 3 | / | 4 | 5 |
function computeGridLayout(n: number): object {
    if (n <= 1) { return { orientation: 0, groups: [{}] }; }
    if (n === 2) { return { orientation: 0, groups: [{}, {}] }; }

    const topCount = Math.ceil(n / 2);
    const bottomCount = Math.floor(n / 2);
    const topGroups = Array.from({ length: topCount }, () => ({}));
    const bottomGroups = Array.from({ length: bottomCount }, () => ({}));

    return {
        orientation: 1, // vertical stacking (rows)
        groups: [
            { groups: topGroups, size: 0.5 },
            { groups: bottomGroups, size: 0.5 }
        ]
    };
}

function computeLinearLayout(n: number): object {
    const groups = Array.from({ length: n }, () => ({}));
    return { orientation: 0, groups };
}

async function applyLayout(folderCount: number) {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    const mode = config.get<string>('layout', 'grid');
    const layout = mode === 'all-right'
        ? computeLinearLayout(folderCount)
        : computeGridLayout(folderCount);

    log(`Applying ${mode} layout for ${folderCount} folders: ${JSON.stringify(layout)}`);
    await vscode.commands.executeCommand('vscode.setEditorLayout', layout);
}

// Snapshot of each group's preview tab URI from BEFORE the current event.
// When a misplaced file opens as preview in the wrong group, VS Code replaces
// the existing preview there before we can act. This lets us restore it.
let prevPreviews: Map<number, string> = new Map();

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

function enableTabColors() {
    if (decorationDisposable) { return; }
    decorationDisposable = vscode.window.registerFileDecorationProvider(new FolderColorDecorationProvider());
    log('Tab color coding enabled');
}

function disableTabColors() {
    decorationDisposable?.dispose();
    decorationDisposable = undefined;
    log('Tab color coding disabled');
}

async function setupTerminals(folders: readonly vscode.WorkspaceFolder[]) {
    // Don't duplicate if terminals already exist
    if (vscode.window.terminals.length > 0) {
        log('Terminals already exist, skipping terminal setup');
        return;
    }

    let firstTerminal: vscode.Terminal | undefined;
    for (const folder of folders) {
        const color = getFolderColor(folder.index);
        if (!firstTerminal) {
            firstTerminal = vscode.window.createTerminal({
                name: folder.name,
                cwd: folder.uri,
                color
            });
        } else {
            vscode.window.createTerminal({
                name: folder.name,
                cwd: folder.uri,
                color,
                location: { parentTerminal: firstTerminal }
            });
        }
        log(`Created terminal "${folder.name}" (color: ${FOLDER_COLOR_IDS[folder.index % FOLDER_COLOR_IDS.length]})`);
    }
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Pane Manager');
    context.subscriptions.push(outputChannel);

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) {
        log(`Skipping activation: ${folders?.length ?? 0} workspace folder(s)`);
        return;
    }

    log(`Activated with ${folders.length} folders:`);
    for (const f of folders) {
        log(`  [${f.index}] ${f.name} → col ${f.index + 1}`);
    }

    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    isEnabled = config.get('enabled', true);

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'multiRootPaneManager.toggle';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    statusBarItem.show();

    // Prevent VS Code from collapsing empty editor groups (would shift all viewColumns)
    const editorConfig = vscode.workspace.getConfiguration('workbench.editor');
    if (editorConfig.get('closeEmptyGroups') !== false) {
        editorConfig.update('closeEmptyGroups', false, vscode.ConfigurationTarget.Workspace);
        log('Set workbench.editor.closeEmptyGroups = false (workspace)');
    }

    // Apply editor layout, sort existing tabs, and start listening
    if (isEnabled) {
        // Delay sorting slightly to ensure tabs are fully restored on startup
        applyLayout(folders.length)
            .then(() => new Promise(resolve => setTimeout(resolve, 500)))
            .then(() => sortAllOpenTabs())
            .catch(err => log(`Layout apply or tab sorting failed: ${err}`));
        startListening();
    }

    // Tab color coding
    try {
        if (config.get('colorTabs', true)) {
            enableTabColors();
        }
    } catch (err) {
        log(`Tab color init failed: ${err}`);
    }

    // Split terminals
    try {
        if (config.get('colorTerminals', true)) {
            setupTerminals(folders);
        }
    } catch (err) {
        log(`Terminal setup failed: ${err}`);
    }

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('multiRootPaneManager.toggle', () => {
            isEnabled = !isEnabled;
            updateStatusBar();
            if (isEnabled) {
                const f = vscode.workspace.workspaceFolders;
                if (f && f.length >= 2) {
                    applyLayout(f.length)
                        .then(() => sortAllOpenTabs())
                        .catch(err => log(`Toggle: layout or sorting failed: ${err}`));
                }
                startListening();
                vscode.window.showInformationMessage('Pane Manager: ON');
            } else {
                stopListening();
                vscode.window.showInformationMessage('Pane Manager: OFF');
            }
        }),
        vscode.commands.registerCommand('multiRootPaneManager.reset', () => {
            const f = vscode.workspace.workspaceFolders;
            if (f && f.length >= 2) {
                applyLayout(f.length)
                    .then(() => sortAllOpenTabs())
                    .catch(err => log(`Reset: layout or sorting failed: ${err}`));
            }
            vscode.window.showInformationMessage('Pane Manager: Layout reset');
        }),
        vscode.commands.registerCommand('multiRootPaneManager.sortTabs', async () => {
            const f = vscode.workspace.workspaceFolders;
            if (!f || f.length < 2) {
                vscode.window.showWarningMessage('Pane Manager: Multi-root workspace required');
                return;
            }
            try {
                await sortAllOpenTabs();
                vscode.window.showInformationMessage('Pane Manager: Tabs sorted');
            } catch (err) {
                log(`Manual sort failed: ${err}`);
                vscode.window.showErrorMessage('Pane Manager: Sort failed');
            }
        })
    );

    // Config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('multiRootPaneManager.enabled')) {
                const newEnabled = vscode.workspace.getConfiguration('multiRootPaneManager').get('enabled', true);
                if (newEnabled !== isEnabled) {
                    isEnabled = newEnabled;
                    if (isEnabled) {
                        const f = vscode.workspace.workspaceFolders;
                        if (f && f.length >= 2) {
                            applyLayout(f.length)
                                .then(() => sortAllOpenTabs())
                                .catch(err => log(`Config enable: layout or sorting failed: ${err}`));
                        }
                        startListening();
                    } else {
                        stopListening();
                    }
                    updateStatusBar();
                }
            }
            if (e.affectsConfiguration('multiRootPaneManager.layout')) {
                const f = vscode.workspace.workspaceFolders;
                if (isEnabled && f && f.length >= 2) {
                    applyLayout(f.length)
                        .then(() => sortAllOpenTabs())
                        .catch(err => log(`Layout change: sorting failed: ${err}`));
                }
            }
            if (e.affectsConfiguration('multiRootPaneManager.colorTabs')) {
                const on = vscode.workspace.getConfiguration('multiRootPaneManager').get('colorTabs', true);
                on ? enableTabColors() : disableTabColors();
            }
        })
    );
}

function startListening() {
    if (tabDisposable) {
        return;
    }
    tabDisposable = vscode.window.tabGroups.onDidChangeTabs(onTabsChanged);
}

function stopListening() {
    tabDisposable?.dispose();
    tabDisposable = undefined;
}

async function onTabsChanged(event: vscode.TabChangeEvent) {
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

    log(`EVENT — opened: ${event.opened.length}, changed: ${event.changed.length}, closed: ${event.closed.length}`);
    dumpTabGroups('before processing');

    for (const tab of event.opened) {
        const fileName = tab.input instanceof vscode.TabInputText
            ? tab.input.uri.path.split('/').pop()
            : null;

        if (!(tab.input instanceof vscode.TabInputText)) {
            log(`  SKIP non-text tab: ${tab.label}`);
            continue;
        }

        const uri = tab.input.uri;
        const root = vscode.workspace.getWorkspaceFolder(uri);
        if (!root) {
            log(`  SKIP ${fileName} — no workspace folder match`);
            continue;
        }

        const targetColumn = root.index + 1;
        const currentColumn = tab.group.viewColumn;

        log(`  TAB "${fileName}" — root: ${root.name}[${root.index}], current col: ${currentColumn}, target col: ${targetColumn}, preview: ${tab.isPreview}`);

        if (currentColumn !== targetColumn) {
            // Check if this preview tab displaced an existing preview in the wrong group
            let displacedPreviewUri: string | undefined;
            if (tab.isPreview) {
                const prevUri = prevPreviews.get(currentColumn);
                if (prevUri && prevUri !== uri.toString()) {
                    displacedPreviewUri = prevUri;
                    log(`  → displaced preview in col ${currentColumn}: ${vscode.Uri.parse(prevUri).path.split('/').pop()}`);
                }
            }

            log(`  → MOVING "${fileName}" from col ${currentColumn} to col ${targetColumn}`);
            await moveTab(tab, targetColumn, displacedPreviewUri);
            dumpTabGroups('after move');
        } else if (tab.isPreview) {
            // Pin preview tabs so they don't get replaced by the next single-click
            log(`  → PINNING "${fileName}" in col ${currentColumn} (was preview)`);
            await pinTab(tab);
        } else {
            log(`  → OK, already in correct column`);
        }
    }

    // Update snapshot for next event
    prevPreviews = snapshotPreviews();
}

async function moveTab(tab: vscode.Tab, targetColumn: vscode.ViewColumn, displacedPreviewUri?: string) {
    if (!(tab.input instanceof vscode.TabInputText)) {
        return;
    }

    const fileName = tab.input.uri.path.split('/').pop();
    const sourceColumn = tab.group.viewColumn;
    isMoving = true;
    try {
        const uri = tab.input.uri;

        // Close the misplaced tab first (while the reference is still valid)
        log(`    close "${fileName}" in col ${sourceColumn}...`);
        await vscode.window.tabGroups.close(tab);
        log(`    close done`);

        // Restore the preview tab that was displaced in the source group
        if (displacedPreviewUri) {
            const restoredUri = vscode.Uri.parse(displacedPreviewUri);
            const restoredName = restoredUri.path.split('/').pop();
            log(`    restoring displaced preview "${restoredName}" in col ${sourceColumn}...`);
            await vscode.commands.executeCommand('vscode.open', restoredUri, {
                viewColumn: sourceColumn,
                preview: true
            });
            log(`    restore done`);
        }

        // Open in the correct pane (vscode.open handles both text and binary files)
        log(`    open "${fileName}" in col ${targetColumn} (preview: false)...`);
        await vscode.commands.executeCommand('vscode.open', uri, {
            viewColumn: targetColumn,
            preview: false
        });
        log(`    open done`);
    } catch (err) {
        log(`    ERROR: ${err}`);
        console.error('Pane Manager: error moving tab', err);
    } finally {
        isMoving = false;
        log(`    isMoving reset to false`);
    }
}

async function pinTab(tab: vscode.Tab) {
    if (!(tab.input instanceof vscode.TabInputText)) {
        return;
    }

    isMoving = true;
    try {
        await vscode.commands.executeCommand('vscode.open', tab.input.uri, {
            viewColumn: tab.group.viewColumn,
            preview: false
        });
        log(`    pin done`);
    } catch (err) {
        log(`    PIN ERROR: ${err}`);
    } finally {
        isMoving = false;
    }
}

async function sortAllOpenTabs() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) {
        return;
    }

    log('Sorting all open tabs...');
    dumpTabGroups('before sorting');

    // Collect all tabs that need to be moved
    const tabsToMove: Array<{ tab: vscode.Tab; targetColumn: vscode.ViewColumn; uri: vscode.Uri }> = [];

    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (!(tab.input instanceof vscode.TabInputText)) {
                continue;
            }

            const uri = tab.input.uri;
            const root = vscode.workspace.getWorkspaceFolder(uri);
            if (!root) {
                continue;
            }

            const targetColumn = root.index + 1;
            const currentColumn = tab.group.viewColumn;

            if (currentColumn !== targetColumn) {
                tabsToMove.push({ tab, targetColumn, uri });
            }
        }
    }

    if (tabsToMove.length === 0) {
        log('No tabs need sorting');
        return;
    }

    log(`Found ${tabsToMove.length} tab(s) to sort`);

    // Move tabs one at a time
    isMoving = true;
    try {
        for (const { tab, targetColumn, uri } of tabsToMove) {
            const fileName = uri.path.split('/').pop();
            const sourceColumn = tab.group.viewColumn;

            log(`  Moving "${fileName}" from col ${sourceColumn} to col ${targetColumn}`);

            // Close in current location
            await vscode.window.tabGroups.close(tab);

            // Open in target location (not as preview)
            await vscode.commands.executeCommand('vscode.open', uri, {
                viewColumn: targetColumn,
                preview: false
            });
        }
    } catch (err) {
        log(`ERROR sorting tabs: ${err}`);
        console.error('Pane Manager: error sorting tabs', err);
    } finally {
        isMoving = false;
    }

    dumpTabGroups('after sorting');
    log('Tab sorting complete');
}

function updateStatusBar() {
    statusBarItem.text = isEnabled
        ? '$(split-horizontal) Pane Mgr: ON'
        : '$(split-horizontal) Pane Mgr: OFF';
    const folderCount = vscode.workspace.workspaceFolders?.length ?? 0;
    statusBarItem.tooltip = `Multi-Root Pane Manager (click to toggle)\nWorkspace folders: ${folderCount}`;
    statusBarItem.backgroundColor = isEnabled
        ? undefined
        : new vscode.ThemeColor('statusBarItem.warningBackground');
}

export function deactivate() {
    stopListening();
    disableTabColors();
}
