import * as vscode from 'vscode';

const LOG_PREFIX = '[PaneMgr]';
let outputChannel: vscode.OutputChannel;

export function initLog(ctx: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Pane Manager');
    ctx.subscriptions.push(outputChannel);
}

export function log(msg: string) {
    const ts = new Date().toISOString().slice(11, 23);
    outputChannel.appendLine(`${ts} ${LOG_PREFIX} ${msg}`);
}

export function dumpTabGroups(label: string) {
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
