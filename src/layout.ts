import * as vscode from 'vscode';
import { log } from './log';

export function computeGridLayout(n: number): object {
    if (n <= 1) { return { orientation: 0, groups: [{}] }; }
    if (n === 2) { return { orientation: 0, groups: [{}, {}] }; }

    const topCount = Math.ceil(n / 2);
    const bottomCount = Math.floor(n / 2);
    return {
        orientation: 1,
        groups: [
            { groups: Array.from({ length: topCount }, () => ({})), size: 0.5 },
            { groups: Array.from({ length: bottomCount }, () => ({})), size: 0.5 }
        ]
    };
}

export function computeLinearLayout(n: number): object {
    return { orientation: 0, groups: Array.from({ length: n }, () => ({})) };
}

export function computePrimaryFocusLayout(n: number, primaryPos: number = 0): object {
    if (n <= 1) { return { orientation: 0, groups: [{}] }; }

    const clamped = Math.min(primaryPos, n - 1);
    const otherSize = 0.3;
    const primarySize = 0.7;
    const otherCount = n - 1;

    if (n === 2) {
        return clamped === 0
            ? { orientation: 0, groups: [{ size: primarySize }, { size: otherSize }] }
            : { orientation: 0, groups: [{ size: otherSize }, { size: primarySize }] };
    }

    const leftCount = clamped;
    const rightCount = n - 1 - clamped;
    const groups: object[] = [];

    if (leftCount > 0) {
        const leftSize = otherSize * (leftCount / otherCount);
        const leftGroups = Array.from({ length: leftCount }, () => ({}));
        groups.push(leftCount === 1 ? { size: leftSize } : { groups: leftGroups, size: leftSize });
    }
    groups.push({ size: primarySize });
    if (rightCount > 0) {
        const rightSize = otherSize * (rightCount / otherCount);
        const rightGroups = Array.from({ length: rightCount }, () => ({}));
        groups.push(rightCount === 1 ? { size: rightSize } : { groups: rightGroups, size: rightSize });
    }

    return { orientation: 0, groups };
}

// --- Pane state ---

let lazyPanes = true;
let activeFolderIndices: number[] = [];
let primaryPaneIndex = 0;

export function initPanes(lazy: boolean) { lazyPanes = lazy; }
export function isLazy() { return lazyPanes; }
export function getActiveFolderIndices() { return activeFolderIndices; }
export function setActiveFolderIndices(indices: number[]) { activeFolderIndices = indices; }
export function getPrimaryPaneIndex() { return primaryPaneIndex; }
export function setPrimaryPaneIndex(i: number) { primaryPaneIndex = i; }

export function getColumnForFolder(folderIndex: number): number {
    if (!lazyPanes) { return folderIndex + 1; }
    const pos = activeFolderIndices.indexOf(folderIndex);
    return pos === -1 ? -1 : pos + 1;
}

export function getActivePaneCount(): number {
    if (!lazyPanes) {
        const f = vscode.workspace.workspaceFolders;
        return f ? f.length : 1;
    }
    return Math.max(activeFolderIndices.length, 1);
}

export async function applyLayout(folderCount: number) {
    const config = vscode.workspace.getConfiguration('multiRootPaneManager');
    const mode = config.get<string>('layout', 'primary-focus');
    let layout;

    switch (mode) {
        case 'all-right':
            layout = computeLinearLayout(folderCount);
            break;
        case 'primary-focus':
            layout = computePrimaryFocusLayout(folderCount, primaryPaneIndex);
            break;
        default:
            layout = computeGridLayout(folderCount);
    }

    log(`Applying ${mode} layout for ${folderCount} folders (primary=${primaryPaneIndex}): ${JSON.stringify(layout)}`);
    await vscode.commands.executeCommand('vscode.setEditorLayout', layout);
}

export async function ensurePaneForFolder(folderIndex: number): Promise<number> {
    if (!lazyPanes) { return folderIndex + 1; }
    if (activeFolderIndices.indexOf(folderIndex) === -1) {
        activeFolderIndices.push(folderIndex);
        activeFolderIndices.sort((a, b) => a - b);
        log(`Lazy pane: folder ${folderIndex} now active, total active: ${activeFolderIndices.length}`);
        await applyLayout(activeFolderIndices.length);
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return activeFolderIndices.indexOf(folderIndex) + 1;
}
