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

let isEnabled = true;
let isMoving = false;
let statusBarItem: vscode.StatusBarItem;
let tabDisposable: vscode.Disposable | undefined;

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

    // Start listening
    if (isEnabled) {
        startListening();
    }

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('multiRootPaneManager.toggle', () => {
            isEnabled = !isEnabled;
            updateStatusBar();
            if (isEnabled) {
                startListening();
                vscode.window.showInformationMessage('Pane Manager: ON');
            } else {
                stopListening();
                vscode.window.showInformationMessage('Pane Manager: OFF');
            }
        }),
        vscode.commands.registerCommand('multiRootPaneManager.reset', () => {
            vscode.window.showInformationMessage('Pane Manager: Reset');
        })
    );

    // Config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('multiRootPaneManager.enabled')) {
                const newEnabled = vscode.workspace.getConfiguration('multiRootPaneManager').get('enabled', true);
                if (newEnabled !== isEnabled) {
                    isEnabled = newEnabled;
                    isEnabled ? startListening() : stopListening();
                    updateStatusBar();
                }
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
}
