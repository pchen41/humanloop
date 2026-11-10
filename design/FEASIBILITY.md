# Design vs. codebase: what to keep, add and drop

The mockups are aspirational. This maps each design feature to the current code
(`src/renderer`, `src/shared`, `src/main`) so an implementer knows what is a restyle, what
is a small addition, and what is new work. Items marked **asked for** were explicit owner
decisions and stay in even though they are not trivial.

## Already in the code: restyle only

- Four queues with collapsible headers; Done collapsed by default (`Sidebar.tsx`).
- "Nothing waiting on you" when Your turn is empty.
- Wait times per row (`formatWait`), refreshed every 30s.
- Next task, Back, Forward, Park, Mark done, New/Close tab, tab 1–9, Find, Clear terminal
  as menu commands with recordable shortcuts (`commands.ts`, `ShortcutsSection.tsx`).
- "Nothing else needs you" notice after Next task finds nothing (`App.tsx` `Notice`).
- Find bar with count and next/previous (`FindBar.tsx`).
- Resume banner after relaunch with the session's directory, Resume and Dismiss
  (`TaskView.tsx`); resume offers are keyed by tab id and available to the renderer.
- Task editor with title, P0–P3 segmented priority, description, and turn-rule overrides
  (`TaskEditor.tsx`, `PolicyControls.tsx`); P0–P3 with default P2 is already the model.
- Settings with the three turn rules, default directory, notifications, keep-awake, hook
  status with Install / Update / Remove, shortcut recording with reset, remove and a
  conflict prompt (`SettingsView.tsx`). Settings apply instantly already.
- Hidden title bar with a drag region at the top of the sidebar.
- Dock badge, notifications, power-save blocker (`dock.ts`).
- Terminal links already open in the default browser (web-links addon + `setWindowOpenHandler`).

## Small changes (an hour or less each)

- Priority chip only on P0 and P1: a condition in the sidebar row.
- One dot per tab instead of one per task: the row maps `task.tabs` to `agents[tab.id]`;
  the data is already in the renderer. Dashed "can resume" dot from `data.resume[tab.id]`.
- Queue header labels in sentence case ("Your turn"); counts always shown.
- Remove: the cwd next to the task title, the tab shortcut hints, the override mark on rows,
  the "+ New Task" button at the bottom of the sidebar, the `kbd` chips on buttons.
- Header bar in the main column with the task title at the left, then New task (icon),
  Settings (icon), and the **Next button that names the task ⌘↩ will open** (**asked for**).
  The title moves into this bar; there is no separate task header row. The target is
  `tasksInQueue(state,'yourTurn')` minus the open task, which `queues.ts` already computes.
  The quiet state and the popover reuse the existing `nothingElse` notice.
- Back / Forward icon buttons next to the traffic lights (`canGoBack` / `canGoForward` exist).
- Edit / Park / Done become icon buttons next to the title, shown only while the pointer is
  over the top bar (CSS `opacity` on hover; keep them focusable), each with a name-and-
  shortcut tooltip. Long titles ellipsise; a tooltip shows the full title when truncated.
- Description line under the task title with clickable links (**asked for**): render the
  existing `task.description` as one ellipsised line and linkify URLs; the window-open
  handler already sends http(s) links to the default browser.
- Underline tabs, no close × until hover, glyph colours per state: CSS.
- Empty-state copy and the "No tabs" state: text changes.
- Task editor: drop the directory field (**asked for**; keep `defaultCwd` in the model,
  just stop showing it), make the turn-rules `<details>` closed by default, and change
  `PolicyControls` to two options with a "(default)" suffix: picking the global value stores
  `undefined`, picking the other stores it. Wording as in SPEC.md.
- Settings copy, row layout, "Turn rules" heading, and the conflict line reading
  "Used by X." with **Reassign** / **Cancel** (**asked for**; rename the existing
  "Use it here instead" link).
- Terminal theme values (`terminals.ts` `THEME`), fonts and the token colours in
  `styles.css`. Keep system fonts (SF Pro / SF Mono) unless you want to bundle Inter and
  JetBrains Mono; the mockups use them only because they are loaded from the web.

- **Reorder tabs by dragging** (`TabDrag.html`). Pointer events on the tab strip, not HTML5
  drag and drop (Electron's native drag image is a washed-out snapshot and cannot be styled).
  On pointerdown record the tab and x; past 4px, render the ghost as a fixed-position copy
  that follows `clientX`, give the strip's other tabs a transform that slides them around
  the slot index under the pointer, and on pointerup splice `task.tabs` to the new index and
  persist. Esc cancels. An hour or two; the order already lives in the tab array.

## New work that stays in (asked for)

- **Settings as a full pane with a left nav** (**asked for**). Today Settings is a modal over
  the window. Render it in the main column instead (sidebar stays), with a 190px section
  nav that scrolls to each section. Mostly layout and CSS; the section components already
  exist. Half a day.
- **Open new tabs in the current tab's directory.** Built: a new tab starts in the current
  tab's shell directory, read from the system with `lsof` (ca5d3db dropped the OSC 7 path).
  It is a toggle in Settings > Tabs (`newTabsInCurrentDir` in settings.json, default on);
  off, new tabs use the task's directory or the default directory.
- **Light theme.** `styles.css` already uses CSS variables and `color-scheme: dark`, so the
  chrome is a second variable set under `prefers-color-scheme: light`. The terminal needs a
  second `THEME` and a `matchMedia` listener to swap it on open terminals. Values are in
  SPEC.md. A couple of hours; do it last.

- **Per-tab turn rules and muted tabs** (**asked for**). `Tab` gains `muted?: boolean` and
  `policy?: Partial<Pick<Policy,'subagentsBusy'|'backgroundShellsBusy'>>`; `normalize.ts`
  validates both. `taskAgentState` in `agents.ts` skips muted tabs and resolves each tab's
  policy as tab → task → global before reading hook state. A tab menu (`TabMenu.html`)
  replaces the × on tabs: Mute tab, two submenus for the turn rules, Close tab. Tabs get a
  100–220px width and a tooltip. Half a day plus tests for the resolution order.
- **Explicit inherit option on turn rules** (**asked for**). `PolicyControls` goes back to
  three options: Default (resolved value as suffix) / the two values; picking Default
  stores `undefined`. In the tab menu the rules are submenus whose first item reads
  "Task's setting". The editor's disclosure says how many fields are overridden.

- **Shell integration** (**asked for**). Each tab's zsh starts from Humanloop's own startup
  files (`ZDOTDIR` pointed at its data folder), which run the user's files unchanged, then
  wrap `claude` to pass Humanloop's hooks with `--settings` (Claude Code adds them to the
  user's own and runs an identical command once) and print a mark as each command starts
  and each prompt appears. Under the "Running commands" turn rule (Wait for them
  by default; set globally, per task or per tab), a command running for 5 seconds is the
  agent's turn until it ends. Nothing in the user's zsh or Claude settings is
  written.

## Drop for now (new features the mockups show but nobody asked for)

- The ⌘K jump palette. New UI, search, and a command; ⌘K is also Clear terminal today.
  Opening tasks from the sidebar covers it.
- "Resume all Claude sessions" command and the "N sessions can be resumed" sidebar footer.
- Last-seen time in the resume banner ("until 10:41"); `ResumeOffer` only has the id and cwd.
- Commands that exist only in the mockup's shortcut list: raise/lower priority, rename tab,
  reopen closed tab, toggle sidebar, scroll to bottom, text size. Keep `commands.ts` as the
  list of truth, including its bindings (⌘← / ⌘→ for tabs, ⌘↑ / ⌘↓ for the task above or
  below in the sidebar, ⌘⇧E for Edit task, ⌘⇧D for Mark done).
- Compact 30px rows for long lists. Optional CSS; not needed.

## Keep from the code even though the mockups leave it out

- "Use Option as Meta" terminal setting.
- Hook states beyond the three shown (unreadable, disabled) and their explanations.
- "Open settings.json" button in Settings.
- Double-click a row to edit, right-click for the task menu, drag-and-drop file paths into
  the terminal, the sidebar resizer.
