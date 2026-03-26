import * as vscode from 'vscode';
import * as path from 'path';

const LOG_PREFIX = '[PaneMgr]';
let outputChannel: vscode.OutputChannel;
let context: vscode.ExtensionContext;

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

function getFolderColor(index: number): vscode.ThemeColor | string {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    const customColors = config.get<string[]>('customColors', []);

    if (customColors.length > 0) {
        return customColors[index % customColors.length];
    }

    return new vscode.ThemeColor(FOLDER_COLOR_IDS[index % FOLDER_COLOR_IDS.length]);
}

// Sticky tabs - manually moved tabs that should not be auto-routed
let stickyTabs = new Set<string>();

function isStickyTab(uri: vscode.Uri): boolean {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    if (!config.get('enableStickyTabs', true)) {
        return false;
    }
    return stickyTabs.has(uri.toString());
}

function markAsSticky(uri: vscode.Uri) {
    stickyTabs.add(uri.toString());
    saveStickyTabs();
}

function unmarkAsSticky(uri: vscode.Uri) {
    stickyTabs.delete(uri.toString());
    saveStickyTabs();
}

function saveStickyTabs() {
    if (context) {
        context.workspaceState.update('stickyTabs', Array.from(stickyTabs));
    }
}

function loadStickyTabs() {
    if (context) {
        const saved = context.workspaceState.get<string[]>('stickyTabs', []);
        stickyTabs = new Set(saved);
    }
}

// Check if file matches exclude patterns
function isExcluded(uri: vscode.Uri): boolean {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    const patterns = config.get<string[]>('excludePatterns', []);

    if (patterns.length === 0) {
        return false;
    }

    const relativePath = vscode.workspace.asRelativePath(uri, false);

    // Simple glob matching
    return patterns.some(pattern => {
        const regexPattern = pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(relativePath);
    });
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
        const colorValue = getFolderColor(folder.index);
        const color = typeof colorValue === 'string'
            ? undefined // Custom hex colors not fully supported in decorations, skip color
            : colorValue;

        return new vscode.FileDecoration(badge, folder.name, color);
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
let terminalMap = new Map<string, vscode.Terminal>(); // folder name -> terminal
let lastActiveColumn: vscode.ViewColumn | undefined;

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

function computePrimaryFocusLayout(n: number): object {
    if (n <= 1) { return { orientation: 0, groups: [{}] }; }
    if (n === 2) { return { orientation: 0, groups: [{ size: 0.7 }, { size: 0.3 }] }; }

    // Primary folder gets 70%, others split the remaining 30%
    const primary = { size: 0.7 };
    const others = Array.from({ length: n - 1 }, () => ({}));
    return {
        orientation: 0,
        groups: [primary, { groups: others, size: 0.3 }]
    };
}

async function applyLayout(folderCount: number) {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    const mode = config.get<string>('layout', 'grid');
    let layout;

    switch (mode) {
        case 'all-right':
            layout = computeLinearLayout(folderCount);
            break;
        case 'primary-focus':
            layout = computePrimaryFocusLayout(folderCount);
            break;
        default:
            layout = computeGridLayout(folderCount);
    }

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
        // Still map existing terminals
        for (const terminal of vscode.window.terminals) {
            for (const folder of folders) {
                if (terminal.name === folder.name) {
                    terminalMap.set(folder.name, terminal);
                }
            }
        }
        return;
    }

    let firstTerminal: vscode.Terminal | undefined;
    for (const folder of folders) {
        const colorValue = getFolderColor(folder.index);
        const color = typeof colorValue === 'string'
            ? new vscode.ThemeColor('terminal.ansiBlue') // Fallback - custom colors not supported in terminals yet
            : colorValue;

        const terminal = !firstTerminal
            ? vscode.window.createTerminal({
                name: folder.name,
                cwd: folder.uri,
                color
            })
            : vscode.window.createTerminal({
                name: folder.name,
                cwd: folder.uri,
                color,
                location: { parentTerminal: firstTerminal }
            });

        if (!firstTerminal) {
            firstTerminal = terminal;
        }

        terminalMap.set(folder.name, terminal);
        log(`Created terminal "${folder.name}"`);
    }
}

function focusTerminalForFolder(folder: vscode.WorkspaceFolder) {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    if (!config.get('focusTerminalOnSwitch', true)) {
        return;
    }

    const terminal = terminalMap.get(folder.name);
    if (terminal) {
        terminal.show(true); // true = preserve focus on editor
        log(`Focused terminal for "${folder.name}"`);
    }
}

async function showWelcomeMessage() {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    if (!config.get('showWelcome', true)) {
        return;
    }

    const hasShownWelcome = context.globalState.get('hasShownWelcome', false);
    if (hasShownWelcome) {
        return;
    }

    const result = await vscode.window.showInformationMessage(
        'Multi-Root Pane Manager: Welcome! Each workspace folder now has its own pane. Use Ctrl+Alt+1/2/3 to navigate between panes.',
        'Got it!',
        'Settings',
        'Don\'t show again'
    );

    if (result === 'Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ShaneMain.multi-root-pane-manager');
    } else if (result === 'Don\'t show again') {
        config.update('showWelcome', false, vscode.ConfigurationTarget.Global);
    }

    context.globalState.update('hasShownWelcome', true);
}

export function activate(ctx: vscode.ExtensionContext) {
    context = ctx;
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

    // Load sticky tabs
    loadStickyTabs();

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'multiRootPaneManager.showFolderQuickPick';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    statusBarItem.show();

    // Track active editor changes for terminal focus
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor || !isEnabled) { return; }
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (folder) {
                focusTerminalForFolder(folder);
            }
        })
    );

    // Prevent VS Code from collapsing empty editor groups (would shift all viewColumns)
    const editorConfig = vscode.workspace.getConfiguration('workbench.editor');
    if (editorConfig.get('closeEmptyGroups') !== false) {
        editorConfig.update('closeEmptyGroups', false, vscode.ConfigurationTarget.Workspace);
        log('Set workbench.editor.closeEmptyGroups = false (workspace)');
    }

    // Apply editor layout, sort existing tabs, and start listening
    if (isEnabled) {
        const sortOnStartup = config.get('sortOnStartup', true);
        applyLayout(folders.length)
            .then(() => new Promise(resolve => setTimeout(resolve, 500)))
            .then(() => {
                if (sortOnStartup) {
                    return sortAllOpenTabs();
                }
            })
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

    // Show welcome message
    setTimeout(() => showWelcomeMessage(), 1000);

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
        }),

        // Navigation commands
        vscode.commands.registerCommand('multiRootPaneManager.focusPane1', () => focusPane(1)),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane2', () => focusPane(2)),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane3', () => focusPane(3)),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane4', () => focusPane(4)),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane5', () => focusPane(5)),
        vscode.commands.registerCommand('multiRootPaneManager.focusPane6', () => focusPane(6)),
        vscode.commands.registerCommand('multiRootPaneManager.cyclePaneLeft', () => cyclePane(-1)),
        vscode.commands.registerCommand('multiRootPaneManager.cyclePaneRight', () => cyclePane(1)),

        // Utility commands
        vscode.commands.registerCommand('multiRootPaneManager.openInCorrectPane', async (uri: vscode.Uri) => {
            if (!uri) {
                vscode.window.showWarningMessage('Pane Manager: No file selected');
                return;
            }
            const folder = vscode.workspace.getWorkspaceFolder(uri);
            if (!folder) {
                vscode.window.showWarningMessage('Pane Manager: File not in workspace');
                return;
            }
            const targetColumn = folder.index + 1;
            await vscode.commands.executeCommand('vscode.open', uri, {
                viewColumn: targetColumn,
                preview: false
            });
            log(`Opened ${uri.path} in pane ${targetColumn}`);
        }),

        vscode.commands.registerCommand('multiRootPaneManager.newFileInActiveFolder', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('Pane Manager: No active editor');
                return;
            }

            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (!folder) {
                vscode.window.showWarningMessage('Pane Manager: Active file not in workspace');
                return;
            }

            const relativePath = await vscode.window.showInputBox({
                prompt: `New file in ${folder.name}`,
                placeHolder: 'path/to/file.ext'
            });

            if (!relativePath) { return; }

            const newFileUri = vscode.Uri.file(path.join(folder.uri.fsPath, relativePath));

            try {
                await vscode.workspace.fs.writeFile(newFileUri, new Uint8Array());
                await vscode.commands.executeCommand('vscode.open', newFileUri, {
                    viewColumn: folder.index + 1,
                    preview: false
                });
                log(`Created new file: ${newFileUri.path}`);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to create file: ${err}`);
            }
        }),

        vscode.commands.registerCommand('multiRootPaneManager.showFolderQuickPick', async () => {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length < 2) { return; }

            const items = folders.map(f => ({
                label: `$(folder) ${f.name}`,
                description: `Pane ${f.index + 1}`,
                folder: f
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Jump to workspace folder pane'
            });

            if (selected) {
                focusPane(selected.folder.index + 1);
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

        // Skip excluded files
        if (isExcluded(uri)) {
            log(`  SKIP ${fileName} — matches exclude pattern`);
            continue;
        }

        // Skip sticky tabs
        if (isStickyTab(uri)) {
            log(`  SKIP ${fileName} — sticky tab`);
            continue;
        }

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
    updateStatusBar();
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

            // Skip excluded files
            if (isExcluded(uri)) {
                continue;
            }

            // Skip sticky tabs
            if (isStickyTab(uri)) {
                continue;
            }

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
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) {
        statusBarItem.hide();
        return;
    }

    // Get current folder based on active editor
    const editor = vscode.window.activeTextEditor;
    let currentFolder: vscode.WorkspaceFolder | undefined;
    if (editor) {
        currentFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    }

    // Count tabs per folder
    const tabCounts = new Map<number, number>();
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputText) {
                const folder = vscode.workspace.getWorkspaceFolder(tab.input.uri);
                if (folder) {
                    tabCounts.set(folder.index, (tabCounts.get(folder.index) || 0) + 1);
                }
            }
        }
    }

    if (currentFolder) {
        const tabCount = tabCounts.get(currentFolder.index) || 0;
        statusBarItem.text = `$(folder) ${currentFolder.name} $(file) ${tabCount}`;
    } else {
        statusBarItem.text = isEnabled
            ? '$(split-horizontal) Pane Mgr'
            : '$(split-horizontal) Pane Mgr: OFF';
    }

    const tooltipLines = [`Multi-Root Pane Manager (click to jump)`];
    for (const folder of folders) {
        const count = tabCounts.get(folder.index) || 0;
        tooltipLines.push(`  ${folder.name}: ${count} tabs (Pane ${folder.index + 1})`);
    }
    statusBarItem.tooltip = tooltipLines.join('\n');

    statusBarItem.backgroundColor = isEnabled
        ? undefined
        : new vscode.ThemeColor('statusBarItem.warningBackground');
}

function focusPane(paneNumber: number) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || paneNumber < 1 || paneNumber > folders.length) {
        return;
    }

    const targetColumn = paneNumber;
    const targetFolder = folders.find(f => f.index + 1 === targetColumn);

    // Find first tab in target pane
    for (const group of vscode.window.tabGroups.all) {
        if (group.viewColumn === targetColumn && group.tabs.length > 0) {
            const firstTab = group.tabs[0];
            if (firstTab.input instanceof vscode.TabInputText) {
                vscode.commands.executeCommand('vscode.open', firstTab.input.uri, {
                    viewColumn: targetColumn,
                    preserveFocus: false
                });
                if (targetFolder) {
                    focusTerminalForFolder(targetFolder);
                }
                log(`Focused pane ${paneNumber}`);
                return;
            }
        }
    }

    // If no tabs in pane, just focus the editor group
    vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    log(`Pane ${paneNumber} has no tabs`);
}

function cyclePane(direction: number) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length < 2) { return; }

    const editor = vscode.window.activeTextEditor;
    let currentColumn = editor?.viewColumn || 1;

    let nextColumn = currentColumn + direction;
    if (nextColumn < 1) {
        nextColumn = folders.length;
    } else if (nextColumn > folders.length) {
        nextColumn = 1;
    }

    focusPane(nextColumn);
}

export function deactivate() {
    stopListening();
    disableTabColors();
}
