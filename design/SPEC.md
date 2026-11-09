# Humanloop UI design spec

Handoff for implementing the Humanloop desktop UI. The mockups in `design/mockups/` are
self-contained HTML files at 1440×900 (the token sheet is 1440×1240). Open them in a browser
to see each screen; their markup and CSS are the source of truth for layout, colour and copy.
This document covers the decisions and behaviour that the markup alone does not say.

The existing code (`src/renderer`, `src/shared`) stays the source of truth for data and
behaviour that already works: queues, turn detection, settings persistence, shortcuts
recording. This is a visual and copy redesign on top of it, plus one new setting
(`Open new tabs in the current tab's directory`).

## Principles

- One question organises everything: whose turn is it. Mint means you, blue means Claude,
  everything else is grey. No other hues in the chrome.
- Calm and dense. The terminal is the loudest thing on screen. No status strip, no hint bar,
  no toasts, no boxed tabs, no coloured rails. The Next button is the only coloured control.
- Copy is short and direct. Labels name the thing; a help line, when present, says what the
  setting does, never what the noun means. No marketing voice, no explaining the obvious.
- Shortcuts are not advertised in the UI except a chip on the Next button. They live in
  tooltips, the menu bar and the shortcuts screen.

## Mockup index

| File | Shows |
| --- | --- |
| `Main.html` | Main window in use: 10 tasks across queues, open task with 4 mixed-state tabs, description line with a clickable link |
| `ManyTasks.html` | 30+ tasks, compact 30px rows, Agent's turn and Done collapsed, ⌘K jump palette |
| `NoTasks.html` | First launch, no tasks |
| `TaskNoTabs.html` | Open task with no tabs |
| `YourTurnEmpty.html` | Empty Your turn queue and the popover after pressing ⌘↩ with nothing waiting |
| `TaskEditor.html` | Edit sheet, Turn rules disclosure closed (default) |
| `TaskEditorTurns.html` | Edit sheet, Turn rules open with one override |
| `Resume.html` | After relaunch: one-line resume offer in the tab, resumable dots in the sidebar |
| `SettingsGeneral.html` | Settings: Turn rules, Tabs, Notifications & power, Claude Code |
| `SettingsShortcuts.html` | Settings: shortcuts list, a recording in progress, a conflict |
| `MainLight.html`, `SettingsLight.html` | Light theme of the two above |
| `Tokens.html` | Tokens, type scale, state glyph table, row anatomy |

## Tokens

Dark (default). Light values in parentheses.

Surfaces
- bg/window `#111113` (`#F5F5F7`)
- bg/chrome, sidebar `#17171A` (`#ECECEF`)
- bg/raised: popovers, sheets `#1A1A1E` (`#FFFFFF`)
- bg/selected, hover `#26262B` (`#DFDFE4`)
- bg/terminal `#0C0C0E` (`#FCFCFD`)
- line `#222227` (`#D9D9DE`); line/raised `#2F2F36` (`#CFCFD6`)

Text
- fg/1 `#EDEDF1` (`#1C1C21`)
- fg/2 `#A3A3AD` (`#5A5A66`)
- fg/3 `#8A8A95` (`#6B6B76`)
- fg/4 `#6F6F7A` (`#63636E`) for ages, counts, hints
- fg/5 `#55555E` (`#6B6B76`) for collapsed/disabled headers

Meaning
- you (mint) `#6FD2B0` (`#147C5A`); tint `rgba(111,210,176,.13–.22)` (`#DCEFE6`)
- agent (blue) `#5B9CF6` (`#3B7FE0`)
- done: mint, outlined
- urgent / destructive `#F16C6C` (`#D9453F`), used only for the P0 chip and Delete/Remove
- plain shell outline `#5A5A66` (`#A0A0AA`)

Type
- UI: Inter (fall back to -apple-system / SF Pro). 13/18 body, 12/16 secondary and help,
  15/20 semibold task title, 12/16 semibold queue headers (sentence case, no tracking).
- Mono: JetBrains Mono (fall back to SF Mono / Menlo). 12.5/18 terminal, 10.5–11 for chips,
  ages, shortcut keys.

Spacing and shape
- 4px grid. Heights: window header 44 (holds the task title), tab strip 36, sidebar row 36 (30 in
  compact mode), control 28, segmented control 24, settings row 12px padding.
- Radii: 4 chips, 6 controls and rows, 8 cards and popovers, 12 window and sheets.
- Sidebar width 288, resizable (existing behaviour).

Terminal (xterm theme)
- background `#0C0C0E`, foreground `#CFCFD6`, cursor `#CFCFD6`
- ANSI: black `#2A2A30`, red `#F16C6C`, green `#6CCF9A`, yellow `#F2C46B`, blue `#7EB0FF`,
  magenta `#C58BFF`, cyan `#6FD2B0`, white `#F2F2F6`, bright black `#7D7D89`
- Light: background `#FCFCFD`, foreground `#2B2B33`, red `#D9453F`, green `#2F9E5F`,
  yellow `#8A5A00`, blue `#2F6FD0`, bright black `#8A8A95`
- Padding 16px 20px. No border or radius; the tab strip's 1px bottom line is the only edge.

## Window layout

Hidden title bar. The sidebar's top 44px holds the traffic lights (12px circles at x 13,
gap 8) and back / forward icon buttons at the right; the whole 44px band is a drag region.
The main column's top 44px band holds the task title at the left (15/20 semibold,
ellipsis, 20px from the sidebar edge), then, right-aligned: New task (icon), Settings
(icon), and the Next button. A 1px × 16px separator (line colour) sits 8px before New
task, 8px after the task actions, and fades in with the hover-only task actions, keeping
them apart from the permanent controls. The title sits on the same line as the traffic
lights; there is no separate task header row.

### Sidebar

Queue headers: "Your turn", "Agent's turn", "Parked", "Done". Each is a disclosure button
(small triangle at left, 12/16 semibold fg/3, count at right in mono). Any queue collapses;
Done is collapsed by default. The count on Your turn is mint; all others fg/4.

Row (36px, 30px in compact mode when the list is long): optional priority chip, title with
ellipsis, one 6px dot per tab, age right-aligned in mono. Hovering a row shows a tooltip
with the full title under the row (same raised tooltip as the top bar, max 400px wide,
wraps); `TitleHover.html` shows one.
- Priority chip only for P0 (red fill, dark text) and P1 (grey fill, light text). P2 and P3
  show no chip; order carries them.
- Dots: filled blue = Claude working, filled mint with soft ring = Claude needs you,
  outlined mint = Claude done, grey outline = plain shell, dashed mint outline = resumable.
- Age: how long in the current queue. Mint in Your turn, fg/4 elsewhere. Format 40s, 12m,
  1h 05m, 2d, 2w, 1mo.
- Selected row: bg/selected. No rails, no row colour of its own.
- Order within a queue: priority, then longest waiting first.
- Parked rows use fg/2 for the title.

### Header controls

- Next button: mint tint (`rgba(111,210,176,.13)`), mint text, label `Next  <title of the
  task ⌘↩ would open>  ⌘↩`, title truncated at ~340px. When nothing needs you the button is
  grey, reads `Next ⌘↩`, and pressing it shows a popover under the button for ~3s:
  "Nothing else needs you" / "All N tasks are with Claude." No notice anywhere else.
- No turn meter, no counts in the header.

### Task title

Lives in the top band (above). Edit, Park and Mark done are 26px icon buttons (pencil,
pause bars, check; fg/3, 14px strokes) that sit right-aligned, 2px apart, 8px before the
separator (at least 8px after the title), and are hidden until the pointer is over the
band (fade in over 120ms). Each has a tooltip with its name and shortcut: "Edit task ⌘E",
"Park task ⌘⇧P", "Mark done ⌘⇧D" (Park reads "Unpark task" on a parked task, Mark done
reads "Reopen task" on a done one). They are also reachable by shortcut, the task's
context menu and double-click on a sidebar row. No directory, no queue pill, no override
note.

Long titles: the title ellipsises; the icons and the New task / Settings / Next controls
keep their place at the right. Hovering a cut-off title shows a tooltip with the full
title (raised surface, 12/16, under the title; only when it is actually truncated). The
full title is always complete in the editor. `TitleHover.html` shows the hover state, the
icons and the title tooltip.

Optional description line (under evaluation, shown in `Main.html`): directly under the top
band, the task description as one 12px fg/3 line with ellipsis, 10px above the tab strip;
URLs are clickable links (fg/2, underlined) that open in the default browser. If kept, the
description never wraps in the header; the full text lives in the editor.

### Tabs

Underline tabs, 36px: 9px state glyph + name, 18px apart, active tab fg/1 with a 2px fg/1
underline, inactive fg/3. No close marks or sub-labels; close via ⌘W or hover-revealed ×.
Trailing + icon button for new tab. Glyph colours follow the dot rules above.

### Terminal

Fills the remaining height, flush to the window edges. No footer, no find bar until ⌘F
(find bar floats top-right of the terminal, raised surface, 30px, input + "2 of 5" + up/down/
close icons; see the earlier iteration if needed, otherwise keep the existing component).

### Empty states

- No tasks: centred "No tasks yet" (16px semibold fg/2) and a Next-style mint tint button
  "New task ⌘N". Sidebar shows the four headers with 0 counts and nothing else.
- Task with no tabs: tab strip shows only the + button; centred "No tabs" and "New tab ⌘T".
- Empty Your turn: under the header, one fg/5 line "Nothing waiting on you".
- After restart, Agent's turn empty: "Nothing running yet".

### Jump palette (⌘K)

Centred 640px raised panel over a 55% scrim. Input, "3 of 44" count, rows of 40px: title
with the match underlined in mint, queue name (mint for Your turn, fg/4 otherwise), age.
Footer: ↩ open, esc close, and "Opening a task never changes its queue". Enter opens without
changing queues.

### Resume offer

Shown inside the tab, above the shell, as a single raised row: dashed-mint glyph, "Claude was
running here until 10:41 · ~/Documents/humanloop" (time and directory in mono), then
"Resume ⌘↩" (mint tint) and "Dismiss" (grey). Resume runs `claude --resume <id>` in that tab;
Dismiss keeps the fresh shell and forgets the session. Sidebar footer shows "N sessions can be
resumed ⌘⇧R". Tabs with a resumable session show the dashed glyph.

## Task editor (sheet)

Width 560, raised surface, 12px radius, over a 60% scrim. Header "Edit task" with an esc chip.
Fields, each label-above-control with an optional one-line help:

- Title (required)
- Priority: segmented P0 P1 P2 P3 in mono, help "Lower is more urgent." Default P2.
- Description: textarea. Links in it are clickable where the description is shown.
- Turn rules: a disclosure row, closed by default. Closed label: "Turn rules · Same as
  Settings" (or "Turn rules · N overrides"). Open, it shows three fields:
  - Multiple Claude tabs — "After one finishes (default)" / "After all finish"
    Help: "Decides when a task with more than one Claude running becomes your turn."
  - Background subagents — "Wait for them (default)" / "Ignore them"
    Help: "Whether a task stays Claude's turn while subagents it started are still running."
  - Background shells — "Wait for them (default)" / "Ignore them"
    Help: "Whether a task stays Claude's turn while dev servers or watchers it started are
    still running."
  The global value carries a small "default" suffix inside its segment. Selecting the other
  value tints that segment mint. There is no Inherit option and no override badge.
- No directory field. Tabs follow the global "open in current directory" setting.

Footer: "Delete task…" (red text, left), Cancel, Save ⌘↩ (mint tint).

## Settings

Left nav (190px): Turn rules, Tabs, Notifications & power, Claude Code, Keyboard shortcuts.
Content max-width 760. Every change applies instantly; no save button. Each row is label +
optional help at left, control at right.

Turn rules: the same three rows and words as the editor, two options each, no "default"
suffix (these are the defaults).

Tabs
- "Open new tabs in the current tab's directory" (toggle, default on). Help: "Otherwise new
  tabs use the task's directory, or the default below." New setting; wire it into tab
  creation so the new shell starts in the active tab's cwd when on.
- "Default directory" input + Choose… (folder picker).

Notifications & power
- "Notify me when a task needs my attention" (toggle). Help: "Only while Humanloop is in the
  background."
- "Keep the Mac awake while Claude is working" (toggle).

Claude Code
- Lead: "Humanloop reads Claude's state through a hook in ~/.claude/settings.json."
- Status card with a pill: "Installed" (mint tint), "Out of date" (amber tint
  `rgba(242,196,107,.16)` / `#F2C46B`), "Not installed" (grey). Out of date shows version
  text and Update (mint tint) + Remove (red text). Not installed shows a single Install.

Keyboard shortcuts
- Help line: "Click a shortcut, then press the new keys. Esc cancels." and a "Reset all"
  button.
- Two columns: Tasks; then Tabs and Terminal stacked. Rows 34px: name left, key caps right
  (mono 11px, 20px tall caps with a 2px bottom edge).
- A shortcut changed from its default shows a small blue dot before the keys; hovering a row
  reveals Reset and Remove as grey text buttons.
- Recording: the row gets a 1px mint ring; the keys area shows the chord as it is typed with
  a mint caret. Esc cancels.
- Conflict: a 30px line directly under the recording row: "Used by <command>." at the left,
  then at the right end "Reassign" (mint text) and "Cancel" (grey). Reassign gives the chord
  to the recording command and leaves the other with none.

Default bindings shown in the mockup:
Tasks: Next task ⌘↩, New task ⌘N, Edit task ⌘E, Park task ⌘⇧P, Mark done ⌘D, Jump to task ⌘K,
Back ⌘[, Forward ⌘], Raise priority ⌘⌥↑, Lower priority ⌘⌥↓, Toggle sidebar ⌘\, Settings ⌘,.
Tabs: New tab ⌘T, Close tab ⌘W, Next tab ⌃Tab, Previous tab ⌃⇧Tab, Go to tab ⌘1–9,
Rename tab ⌘R, Reopen closed tab ⌘⇧T, Resume all Claude sessions ⌘⇧R.
Terminal: Find ⌘F, Find next ⌘G, Find previous ⌘⇧G, Clear terminal ⌘L, Scroll to bottom ⌘↓,
Bigger text ⌘=, Smaller text ⌘-, Reset text size ⌘0.
Keep whatever the code already defines where it differs; the list is illustrative.

## Light theme

Same layout and rules; only values change (see Tokens). The Next button is a mint tint
`#DCEFE6` with `#0F5E44` text, never a solid fill. Follow the system appearance.

## Out of scope

No app icon yet. Native menus, dialogs and notifications follow macOS.
