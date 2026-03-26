import * as vscode from 'vscode';

let isEnabled = true;
let statusBarItem: vscode.StatusBarItem;
let documentOpenDisposable: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Multi-Root Pane Manager is now active');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'multiRootPaneManager.toggle';
    context.subscriptions.push(statusBarItem);

    // Check if we're in a multi-root workspace
    const isMultiRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1;

    if (isMultiRoot) {
        // Get configuration
        const config = vscode.workspace.getConfiguration('multiRootPaneManager');
        isEnabled = config.get('enabled', true);

        // Auto-split on activation if there's only one editor group
        if (vscode.window.tabGroups.all.length === 1) {
            splitPane();
        }

        // Set up document open handler
        setupDocumentOpenHandler();

        updateStatusBar();
        statusBarItem.show();
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('multiRootPaneManager.toggle', () => {
            isEnabled = !isEnabled;
            updateStatusBar();

            if (isEnabled) {
                setupDocumentOpenHandler();
                vscode.window.showInformationMessage('Multi-Root Pane Manager: Enabled');
            } else {
                if (documentOpenDisposable) {
                    documentOpenDisposable.dispose();
                    documentOpenDisposable = undefined;
                }
                vscode.window.showInformationMessage('Multi-Root Pane Manager: Disabled');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('multiRootPaneManager.splitNow', () => {
            splitPane();
        })
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('multiRootPaneManager')) {
                const config = vscode.workspace.getConfiguration('multiRootPaneManager');
                const newEnabled = config.get('enabled', true);

                if (newEnabled !== isEnabled) {
                    isEnabled = newEnabled;
                    if (isEnabled) {
                        setupDocumentOpenHandler();
                    } else if (documentOpenDisposable) {
                        documentOpenDisposable.dispose();
                        documentOpenDisposable = undefined;
                    }
                    updateStatusBar();
                }
            }
        })
    );
}

function setupDocumentOpenHandler() {
    // Dispose existing handler if any
    if (documentOpenDisposable) {
        documentOpenDisposable.dispose();
    }

    // Listen for tab changes
    documentOpenDisposable = vscode.window.tabGroups.onDidChangeTabs(async (event) => {
        if (!isEnabled) {
            return;
        }

        const config = vscode.workspace.getConfiguration('multiRootPaneManager');
        const targetPaneIndex = config.get('targetPaneIndex', 1);

        // Check if tabs were opened (added)
        for (const tab of event.opened) {
            const currentGroup = vscode.window.tabGroups.all.find(g =>
                g.tabs.some(t => t === tab)
            );

            if (!currentGroup) {
                continue;
            }

            const currentGroupIndex = vscode.window.tabGroups.all.indexOf(currentGroup);

            // If the tab was opened in the wrong pane and we have multiple groups
            if (currentGroupIndex !== targetPaneIndex && vscode.window.tabGroups.all.length > 1) {
                // Get the target group
                const targetGroup = vscode.window.tabGroups.all[targetPaneIndex];

                if (targetGroup && tab.input) {
                    // Move the tab to the target group
                    await moveTabToGroup(tab, targetGroup);
                }
            }
        }
    });
}

async function moveTabToGroup(tab: vscode.Tab, targetGroup: vscode.TabGroup) {
    try {
        // Get the document URI from the tab
        if (tab.input instanceof vscode.TabInputText) {
            const uri = tab.input.uri;
            const currentGroup = tab.group;

            // Open the document in the target group
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, {
                viewColumn: targetGroup.viewColumn,
                preserveFocus: true,
                preview: tab.isPreview
            });

            // Close the tab in the original group
            await vscode.window.tabGroups.close(tab);
        }
    } catch (error) {
        console.error('Error moving tab:', error);
    }
}

async function splitPane() {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    const splitDirection = config.get('splitDirection', 'vertical');

    try {
        if (splitDirection === 'vertical') {
            await vscode.commands.executeCommand('workbench.action.splitEditorRight');
        } else {
            await vscode.commands.executeCommand('workbench.action.splitEditorDown');
        }

        console.log('Pane split successfully');
    } catch (error) {
        console.error('Error splitting pane:', error);
    }
}

function updateStatusBar() {
    if (isEnabled) {
        statusBarItem.text = '$(split-horizontal) Pane Manager: ON';
        statusBarItem.tooltip = 'Multi-Root Pane Manager is enabled (click to toggle)';
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(split-horizontal) Pane Manager: OFF';
        statusBarItem.tooltip = 'Multi-Root Pane Manager is disabled (click to toggle)';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

export function deactivate() {
    if (documentOpenDisposable) {
        documentOpenDisposable.dispose();
    }
}
