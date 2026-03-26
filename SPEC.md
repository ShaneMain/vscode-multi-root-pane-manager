# Multi-Root Pane Manager — Change Spec

## Base: `feature/enhancements` branch (v1.3.0)

---

## Change 1: Lazy Pane Creation

**Problem:** On startup, panes were created for all workspace folders even if no files were open for some, leaving empty panes.

**Solution:** Added lazy pane management — panes are only created when a file from that folder is actually opened.

**Details:**
- New setting: `multiRootPaneManager.lazyPanes` (boolean, default: `true`)
- On activation, scans already-open tabs to seed the initial set of active folders
- When a file opens from a previously-unseen folder, a new pane is dynamically added and the layout expands
- Folder ordering is preserved (folder 0 always before folder 1, etc.)
- All commands (sort, reset, toggle, quick pick, status bar) respect the lazy column mapping
- `getColumnForFolder(folderIndex)` maps folder index → current pane column (returns -1 if folder has no pane)
- `ensurePaneForFolder(folderIndex)` creates a pane if needed, then returns the column
- Set `lazyPanes: false` to restore the original eager behavior

**Files changed:**
- `src/extension.ts` — added `lazyPanes`, `activeFolderIndices`, `getColumnForFolder()`, `ensurePaneForFolder()`, `getActivePaneCount()`; updated `onTabsChanged`, `sortAllOpenTabs`, `activate`, `openInCorrectPane`, `newFileInActiveFolder`, `showFolderQuickPick`, `updateStatusBar`, toggle/reset/config-change handlers
- `package.json` — added `multiRootPaneManager.lazyPanes` setting

---

## Change 2: Dynamic Primary Focus

**Problem:** The `primary-focus` layout always gave 70% width to the first folder. Users wanted whichever pane they're working in to be the large one.

**Solution:** The primary pane now follows focus — clicking into or opening a file in any pane makes it the 70% primary.

**Details:**
- Default layout changed from `grid` to `primary-focus`
- New state: `primaryPaneIndex` (0-based position in the pane list)
- `computePrimaryFocusLayout(n, primaryPos)` builds a layout with the primary at any position:
  - Panes left of primary share proportional width from the 30% remainder
  - Panes right of primary share the rest
  - Example with 3 panes, primary=1: `| 15% | 70% | 15% |`
- `onDidChangeActiveTextEditor` detects when focus moves to a different folder and re-applies the layout with the new primary
- Only triggers re-layout when the layout mode is `primary-focus`

**Files changed:**
- `src/extension.ts` — added `primaryPaneIndex`; rewrote `computePrimaryFocusLayout()` to accept position; updated `applyLayout()` to pass primary; updated `onDidChangeActiveTextEditor` handler for dynamic switching
- `package.json` — changed `layout` default from `grid` to `primary-focus`

---

## Change 3: Terminal Management Overhaul

**Problem:** The split terminal system created terminals for all workspace folders eagerly on startup, which didn't work reliably. Terminals were created as split panes of each other using `parentTerminal`, which was fragile.

**Solution:** Replaced with lazy, on-demand terminal management. Terminals are created individually (no splits) when you first focus a pane, and the terminal view automatically switches to match the active pane.

**Details:**
- Removed `setupTerminals()` — no more eager terminal creation on startup
- Rewrote `focusTerminalForFolder()`:
  - Finds existing terminal by folder name, or creates one on demand
  - Handles disposed terminals (checks `exitStatus`)
  - Creates standalone terminals (not split) with folder name, cwd, and color
  - Shows terminal with `preserveFocus: true` so editor stays focused
- Removed `focusTerminalOnSwitch` setting (redundant)
- Repurposed `colorTerminals` setting: now controls whether terminal auto-switching is enabled (default: `true`)

**Settings removed:**
- `multiRootPaneManager.focusTerminalOnSwitch`

**Settings changed:**
- `multiRootPaneManager.colorTerminals` — description updated, now controls terminal auto-focus behavior

**Files changed:**
- `src/extension.ts` — removed `setupTerminals()`, `lastActiveColumn`; rewrote `focusTerminalForFolder()`; removed eager terminal setup from `activate()`
- `package.json` — removed `focusTerminalOnSwitch`, updated `colorTerminals` description

---

## Change 4: Fix "Tab close: Invalid tab not found!" Error

**Problem:** When opening files from the explorer, VS Code fires `opened` and `changed` events simultaneously (same millisecond). By the time `moveTab` tried to close the tab using the event's tab reference, VS Code had already mutated/replaced it via the `changed` event, causing `"Tab close: Invalid tab not found!"`. The tab never moved, leaving it in the wrong pane and creating empty panes.

**Root cause:** Stale `vscode.Tab` object references from `event.opened` array.

**Solution:** Two-phase approach:
1. `onTabsChanged` now extracts URI, column, and preview state from event tabs immediately (before they go stale), then waits 50ms for VS Code to settle before processing
2. Before processing, re-finds each tab's actual current location by scanning `tabGroups.all`
3. `moveTab` re-finds the tab fresh from `tabGroups.all` by URI + column before attempting close, gracefully skipping if already gone

**Details:**
- `onTabsChanged`: Early-return for events with no opened tabs. Collects `{ uri, column, isPreview }` from event tabs upfront. 50ms settle delay. Re-scans live tab groups to find current column. Constructs minimal tab info for `moveTab`/`pinTab` instead of passing stale refs.
- `moveTab`: Searches `tabGroups.all` for a fresh tab matching the URI in the source column. If found, closes it. If not found (already gone), logs and skips the close. Then opens in target column as before.

**Files changed:**
- `src/extension.ts` — rewrote `onTabsChanged()` and `moveTab()`

---

## Change 5: Fix Tab Decoration Git Color Clash

**Problem:** The `FileDecorationProvider` applied folder colors to filename text, which clashed with VS Code's built-in git status colors (green=added, yellow=modified, red=deleted). Files could show the folder color instead of their git status, or the colors would fight.

**Solution:** Switched to badge-only decorations with no text color. Each tab gets a 2-character badge (first 2 letters of the folder name, uppercased) and a tooltip showing the folder name and pane number. No color is applied to the filename text, so git decorations render normally.

**Details:**
- Badge: 2-char uppercase prefix of folder name (e.g., "BU" for BurnerBasic..., "PY" for Pylantir)
- Tooltip: `"FolderName (Pane N)"` for quick identification on hover
- `propagate = false` to avoid badges on parent folders in the explorer
- Removed git API watcher (no longer needed since we don't conditionally color)
- Removed all `gitChangedUris` tracking, `initGitWatcher()`, `refreshGitStatus()`

**Files changed:**
- `src/extension.ts` — simplified `FolderColorDecorationProvider` to badge+tooltip only

---

## Change 6: Emoji Badges for Workspace Identification

**Problem:** Text-colored filenames clashed with git status colors. Badge initials were functional but not visually striking.

**Solution:** Use color circle emoji as tab badges. Each workspace folder gets a distinct colored circle emoji (🔵🟢🟡🟣🔴🟠) that appears next to filenames in tabs and the explorer. No text color is applied, so git decorations are completely unaffected.

**Details:**
- Default emoji cycle: 🔵 🟢 🟡 🟣 🔴 🟠
- New setting: `multiRootPaneManager.customEmoji` (string array) — override with your own emoji
- Removed: `customColors` setting (no longer used)
- Removed: `FOLDER_COLOR_IDS` array (replaced by `FOLDER_EMOJI`)
- `getFolderColor()` simplified — only used for terminal tab colors now
- Status bar shows emoji next to folder name: `🔵 MyPackage 📄 3`
- Tooltip shows emoji per folder: `🔵 MyPackage: 3 tabs (Pane 1)`

**Files changed:**
- `src/extension.ts` — added `FOLDER_EMOJI`, `getFolderEmoji()`; updated `FolderColorDecorationProvider`, `updateStatusBar()`; simplified `getFolderColor()`
- `package.json` — replaced `customColors` with `customEmoji`

---

## Change 7: Pane Header Tabs

**Problem:** No visual indicator of which workspace folder a pane belongs to, especially when the pane has many tabs and the emoji badges are small.

**Solution:** Each pane gets a pinned webview tab as a "header" showing the folder's emoji and name. The tab title itself shows `🔵 MyPackage` so it's visible even when the webview content isn't focused.

**Details:**
- `createPaneHeader(folder, column)` creates a lightweight webview panel per pane
  - Tab title: `{emoji} {folderName}`
  - Content: centered emoji (large) + folder name + directory path, subtle opacity
  - `preserveFocus: true` so it doesn't steal focus when created
  - `retainContextWhenHidden: true` so it persists
- `refreshPaneHeaders()` disposes all existing headers and recreates for current active panes
- Headers are created on startup after layout + sort, and when new panes are added via `ensurePaneForFolder`
- Tab routing ignores headers naturally (they're `TabInputWebview`, not `TabInputText`)
- Headers auto-clean up via `onDidDispose`

**Limitation:** The emoji badge position in `FileDecoration` is controlled by VS Code and always renders after the filename — there's no API to prepend it.

**Files changed:**
- `src/extension.ts` — added `headerPanels` map, `createPaneHeader()`, `refreshPaneHeaders()`; hooked into startup and lazy pane creation

---

## Change 8: Pin Headers as Leftmost Tab

**Problem:** Header webview tabs could end up in the middle or right side of the tab bar, especially after sorting or opening new files.

**Solution:** Headers are now pinned and explicitly moved to the first position in their editor group on creation, and re-verified after every sort operation.

**Details:**
- `createPaneHeader()` now: reveals the panel, pins it (`workbench.action.pinEditor`), and moves it to first position (`workbench.action.moveEditorToFirstInGroup`)
- `ensureHeadersLeftmost()` — new function that checks each header panel's position and moves it to first if it's not already there. Matches by comparing `firstTab.label` to `panel.title`.
- Called after `sortAllOpenTabs()` completes
- `createPaneHeader` and `refreshPaneHeaders` are now `async`

**Files changed:**
- `src/extension.ts` — updated `createPaneHeader()` to pin+move; added `ensureHeadersLeftmost()`; called after sort

---

## Change 9: Adopt Existing Terminals

**Problem:** On extension restart (e.g., `Restart Extension Host`), terminals from the previous session survive but `terminalMap` starts empty. The extension would create duplicate terminals for every folder.

**Solution:** Before creating a new terminal, scan `vscode.window.terminals` for an existing one with a matching name that hasn't exited.

**Details:**
- `focusTerminalForFolder()` now has a 3-step lookup:
  1. Check `terminalMap` (our cache)
  2. If not cached, scan `vscode.window.terminals` for a live terminal with `name === folder.name`
  3. Only create a new terminal if neither step found one
- Adopted terminals are added to `terminalMap` for future lookups
- Logs distinguish "Adopted existing terminal" vs "Created terminal"

**Files changed:**
- `src/extension.ts` — updated `focusTerminalForFolder()`

---

## Change 10: Fix Header Pinning and Ordering

**Problem:** Headers were spawning (visible as `(non-text)` in logs) but weren't reliably pinned or moved to the leftmost position. The `refreshPaneHeaders()` call wasn't being awaited in the startup `.then()` chain, causing a race with the sort that followed.

**Solution:**
- Properly `await` `refreshPaneHeaders()` in the startup chain before sorting
- Added delays after `panel.reveal()` (100ms) and after pin+move (50ms) to let VS Code process the commands before moving to the next header

**Files changed:**
- `src/extension.ts` — fixed async `.then()` chains in `activate()`; added timing delays in `createPaneHeader()`

---

## Change 11: Eager Terminal Creation on Startup

**Problem:** Terminals were only created lazily when switching panes, meaning no managed terminals existed until the user first focused each folder.

**Solution:** On activation, iterate all workspace folders and call `focusTerminalForFolder()` for each. This reuses the existing adopt-or-create logic, so it won't duplicate terminals from previous sessions.

**Details:**
- Runs after tab color setup, before welcome message
- Gated by `colorTerminals` setting (same as the rest of terminal management)
- After creating all terminals, shows the first folder's terminal with `preserveFocus: true`
- Existing terminals are adopted, new ones are created — no duplicates

**Files changed:**
- `src/extension.ts` — added eager terminal loop in `activate()`

---

## Change 12: Separate Eager Terminals from Lazy Panes, Make Configurable

**Problem:** Terminals and pane headers had unclear lifecycle — user wanted terminals eager (all created on startup) and pane headers lazy (only when a new pane is created).

**Solution:**
- Terminals: created for all folders on startup (eager), controlled by `eagerTerminals` setting
- Pane headers: only created when `ensurePaneForFolder` adds a new pane (lazy), controlled by `paneHeaders` setting
- Removed `refreshPaneHeaders()` from startup chains — headers no longer spawn for pre-seeded panes

**New settings:**
- `multiRootPaneManager.eagerTerminals` (boolean, default: `true`) — create terminals for all folders on startup
- `multiRootPaneManager.paneHeaders` (boolean, default: `true`) — show pinned header tabs in panes

**Files changed:**
- `src/extension.ts` — gated eager terminals on `eagerTerminals`, gated `createPaneHeader` on `paneHeaders`, removed `refreshPaneHeaders` from startup
- `package.json` — added `eagerTerminals` and `paneHeaders` settings

---

## Change 14: Modularize + Replace Webview Headers with Custom Tab Labels

**Problem:** The webview header system was unreliable (positioning issues, focus stealing, flaky pin commands). The single 1100-line extension.ts was hard to maintain.

**Solution:** 
1. Replaced webview headers with `workbench.editor.customLabels.patterns` — writes workspace settings to prefix tab labels
2. Split extension.ts into 6 modules

**New setting:** `multiRootPaneManager.tabLabelFormat` (enum, default: `none`)
- `emoji-dir-file` → `🔵 FolderName / filename.ext`
- `emoji-file` → `🔵 filename.ext`  
- `dir-file` → `FolderName / filename.ext`
- `none` → default VS Code labels (no modification)

**Removed settings:** `paneHeaders`

**Module structure:**
- `src/log.ts` — output channel, `log()`, `dumpTabGroups()`
- `src/colors.ts` — `getFolderEmoji()`, `getFolderColor()`, emoji/color arrays
- `src/layout.ts` — layout computation, pane state (`activeFolderIndices`, `primaryPaneIndex`), `applyLayout()`, `ensurePaneForFolder()`
- `src/terminals.ts` — terminal creation/adoption/focus, `initTerminals()`
- `src/decorations.ts` — `FolderColorDecorationProvider`, `applyCustomTabLabels()`, `clearCustomTabLabels()`
- `src/routing.ts` — `onTabsChanged()`, `sortAllOpenTabs()`, `moveTab()`, `pinTab()`, sticky tabs, exclusions
- `src/extension.ts` — thin orchestrator: activation, commands, config changes, status bar

**Cleanup on deactivate:** `clearCustomTabLabels()` removes the workspace setting patterns we added
