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
| `Main.html` | Graphite theme (dark, default). Main window in use: 10 tasks across queues, title in the top bar, open task with 4 mixed-state tabs, description line with a clickable link |
| `ManyTasks.html` | 30+ tasks, compact 30px rows, Agent's turn and Done collapsed, ⌘K jump palette |
| `NoTasks.html` | First launch, no tasks |
| `TaskNoTabs.html` | Open task with no tabs |
| `YourTurnEmpty.html` | Empty Your turn queue and the popover after pressing ⌘↩ with nothing waiting |
| `TaskEditor.html` | Edit sheet, Turn rules disclosure closed (default) |
| `TaskEditorTurns.html` | Edit sheet, Turn rules open with one override |
| `TitleMenu.html` | Over-long task title: full-title tooltips in the bar and the sidebar, and the task menu open from the ⌄ by the title |
| `TabMenu.html` | Tab menu open on the active tab: Mute tab, per-tab turn rules with a submenu open, Close; one muted tab |
| `ShellCommand.html` | A command you ran in a shell tab keeps the task the agent's turn: filled grey on the tab and in the sidebar, tooltip with the command and its running time |
| `TabDrag.html` | Reordering tabs: the dragged tab lifted as a ghost, the others slid aside, a faint well at the landing spot |
| `Resume.html` | After relaunch: one-line resume offer in the tab, resumable dots in the sidebar |
| `SettingsGeneral.html` | Settings: Turn rules, Tabs, Notifications & power (its Claude Code section is dropped) |
| `SettingsShortcuts.html` | Settings: shortcuts list, a recording in progress, a conflict |
| `SettingsAppearance.html` | Settings: Appearance (System / Light / Dark) and the dark and light theme cards |
| `MainDusk.html` | Dusk theme (dark, cool, lower contrast) of the main window |
| `MainLight.html`, `SettingsLight.html` | Paper theme (light, neutral) of the main window and Settings |
| `MainLinen.html` | Linen theme (light, warm, lower contrast) of the main window |
| `Tokens.html` | Tokens, type scale, state glyph table, row anatomy |

## Tokens

Four themes, two dark and two light, share one set of roles. Graphite is the default and
the one every mockup except the theme boards uses. A theme changes values only: layout,
shapes, and what each colour means never change.

| Role | Graphite (dark) | Dusk (dark, cool) | Paper (light) | Linen (light, warm) |
| --- | --- | --- | --- | --- |
| bg/window | `#111113` | `#1A1D24` | `#F5F5F7` | `#F4F0E7` |
| bg/chrome, sidebar | `#17171A` | `#20242C` | `#ECECEF` | `#ECE7DB` |
| bg/raised: popovers, sheets | `#1A1A1E` | `#252A33` | `#FFFFFF` | `#FBF8F1` |
| bg/selected, hover | `#26262B` | `#313744` | `#DFDFE4` | `#E2DCCE` |
| bg/terminal | `#131316` | `#1C2027` | `#F7F7F9` | `#F6F2EA` |
| line | `#222227` | `#2C313B` | `#D9D9DE` | `#DDD6C8` |
| line/raised | `#2F2F36` | `#3A4050` | `#CFCFD6` | `#CFC7B7` |
| fg/1 | `#EDEDF1` | `#D9DEE8` | `#1C1C21` | `#2C2721` |
| fg/2 | `#A3A3AD` | `#A3AAB8` | `#5A5A66` | `#5E5649` |
| fg/3 | `#8A8A95` | `#8A91A0` | `#6B6B76` | `#726A5C` |
| fg/4 ages, counts, hints | `#6F6F7A` | `#6F7786` | `#63636E` | `#6E6659` |
| fg/5 collapsed, disabled | `#55555E` | `#58606E` | `#6B6B76` | `#726A5C` |
| you (mint) | `#6FD2B0` | `#7CD4B6` | `#147C5A` | `#1E7A58` |
| you tint (Next button) | `rgba(111,210,176,.13)` | `rgba(124,212,182,.13)` | `#DCEFE6` / text `#0F5E44` | `#DCEBDF` / text `#175C43` |
| agent (amber) | `#E6B450` | `#E2B35C` | `#B4780C` | `#A5680A` |
| urgent / destructive | `#F16C6C` | `#EF7B78` | `#D9453F` | `#C9483E` |
| plain shell outline | `#5A5A66` | `#646C7C` | `#A0A0AA` | `#A89F8F` |
| terminal fg | `#C2C2CA` | `#BFC6D2` | `#3A3A44` | `#443E36` |
| terminal bright white | `#E3E3E9` | `#E0E5EE` | `#2A2A32` | `#2C2721` |

Meaning
- you: mint, always. Filled means Claude needs you; outlined means Claude is done.
- agent: amber. Filled amber means Claude is working. Amber is never urgent and never counts
  in the Dock badge. (It used to be blue; amber reads as "busy, wait" at a glance and keeps
  blue free for links and the terminal's own colours.)
- urgent / destructive: red, used only for the P0 chip and Delete/Remove.
- muted tab: the tab's own glyph and dot at 45% opacity, so its state still reads.
- commands you run: a shell tab whose command has run for 5 seconds (under the "Running
  commands" rule) shows a filled grey disc: grey because it is a shell, filled because it
  is working, the same way the idle shell is a grey ring and Claude working is a filled
  amber disc. The queue, not the colour, says whose turn it is. When the command ends the
  glyph becomes a mint ring (the same "settled, your turn" ring as Claude done) until you
  type in that tab, then it goes back to the plain grey shell ring. The tab tooltip names
  the command and how long it has run ("Running npm run backfill · 4m 12s · agent's turn
  until it ends"); after it ends, the exit status ("npm run backfill finished, exit 0").
  `ShellCommand.html` shows a backfill job holding a task in Agent's turn.

Contrast
- The terminal is no longer a darker well. Its background sits one step off the window
  (lighter in the dark themes, darker in the light ones) and its default text sits one
  step below fg/1, so the hard edge under the tab strip and the bright-on-black glare are
  gone. Dusk and Linen go further: tinted surfaces and text that never reaches pure
  white or near-black.

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
- Graphite: background `#131316`, foreground `#C2C2CA`, cursor `#C2C2CA`
- ANSI: black `#2A2A30`, red `#F16C6C`, green `#6CCF9A`, yellow `#F2C46B`, blue `#7EB0FF`,
  magenta `#C58BFF`, cyan `#6FD2B0`, white `#E3E3E9`, bright black `#7D7D89`
- Dusk: background `#1C2027`, foreground `#BFC6D2`, white `#E0E5EE`, bright black `#7B8393`;
  ANSI colours as Graphite
- Paper: background `#F7F7F9`, foreground `#3A3A44`, red `#D9453F`, green `#2F9E5F`,
  yellow `#8A5A00`, blue `#2F6FD0`, white `#2A2A32`, bright black `#8A8A95`
- Linen: background `#F6F2EA`, foreground `#443E36`, red `#C9483E`, green `#2E8E59`,
  yellow `#85581A`, blue `#3568B8`, white `#2C2721`, bright black `#8C8375`
- Padding 16px 20px. No border or radius; the tab strip's 1px bottom line is the only edge.

## Window layout

Hidden title bar. The sidebar's top 44px holds the traffic lights (12px circles at x 13,
gap 8) and back / forward icon buttons at the right; the whole 44px band is a drag region.
The main column's top 44px band holds the task title at the left (15/20 semibold,
ellipsis, 20px from the sidebar edge) with a ⌄ button 2px after it that opens the task
menu, then, right-aligned: New task (icon), Settings (icon), and the Next button. No
separator. The title sits on the same line as the traffic lights; there is no separate
task header row.

### Sidebar

Queue headers: "Your turn", "Agent's turn", "Parked", "Done". Each is a disclosure button
(small triangle at left, 12/16 semibold fg/3, count at right in mono). Any queue collapses;
Done is collapsed by default. The count on Your turn is mint; all others fg/4.

Row (36px, 30px in compact mode when the list is long): priority chip, title with
ellipsis, one 6px dot per tab, age right-aligned in mono. Hovering a row shows a tooltip
with the full title under the row (same raised tooltip as the top bar, max 400px wide,
wraps); `TitleMenu.html` shows one.
- Priority chip on every row (22×16, mono 10px semibold, radius 4), so titles line up:
  P0 red fill with dark text, P1 grey fill (`#34343C`) with fg/1, P2 quiet fill
  (bg/selected) with fg/2, P3 no fill, a 1px inset line-colour ring and fg/4. Weight falls
  with urgency; queue order still carries the rest.
- Dots: filled amber = Claude working, filled mint with soft ring = Claude needs you,
  outlined mint = Claude done or your command finished, filled grey = a shell running a
  command you gave it, grey outline = idle shell, dashed mint outline = resumable. A muted
  tab's dot is its normal dot at 45% opacity. Filled means working and a ring means
  settled; amber is Claude and grey is a shell.
- Age: how long in the current queue. Mint in Your turn, fg/4 elsewhere. Format 40s, 12m,
  1h 05m, 2d, 2w, 1mo.
- Selected row: bg/selected. No rails, no row colour of its own.
- Order within a queue: priority, then longest waiting first.
- Parked rows use fg/2 for the title.

### Header controls

- Next button: mint tint (`rgba(111,210,176,.13)`), mint text, label `Next  <title of the
  task ⌘↩ would open>  ⌘↩`, title truncated at ~340px. The shortcut is a keycap: 14px mono
  glyphs (they render small, so this matches the 12.5px label optically) in a 20px box with
  6px padding, 1px mint border at 40%, no fill, 4px radius, 90% opacity. The earlier filled
  10.5px chip was too small to read from a distance. Same keycap on the Resume button; the
  quiet grey Next uses a line-colour border. When nothing needs you the button is
  grey, reads `Next ⌘↩`, and pressing it shows a popover under the button for ~3s:
  "Nothing else needs you" / "All N tasks are with Claude." No notice anywhere else.
- No turn meter, no counts in the header.

### Task title

Lives in the top band (above). A 22px ⌄ icon button (fg/3, 12px chevron) sits 2px after
the title text, always visible, with the tooltip "Task actions"; while its menu is open it
takes the selected surface and fg/1. It opens the task menu, anchored to the button's
left edge 4px below it:
- "Edit task…" ⌘E
- "Park task" ⌘⇧P ("Unpark task" on a parked task)
- "Mark done" ⌘⇧D ("Reopen task" on a done task)
- "Delete task…" in red, no shortcut
Separators after Edit and before Delete. Same menu from the sidebar row's context menu
and on double-click of a row; the shortcuts work without the menu. The app builds this
menu, and the tab menu, as native macOS menus; the drawn menus in `TitleMenu.html` and
`TabMenu.html` are the look to use if they are ever rendered in the window. No icon
buttons in the band, no directory, no queue pill, no override note.

Long titles: the title ellipsises and the ⌄ stays right after the visible text; the New
task / Settings / Next controls keep their place at the right. Hovering a cut-off title
shows a tooltip with the full title (raised surface, 12/16, under the title; only when it
is actually truncated). The full title is always complete in the editor. `TitleMenu.html`
shows the tooltip and the open menu.

Optional description line (under evaluation, shown in `Main.html`): directly under the top
band, the task description as one 12px fg/3 line with ellipsis, 10px above the tab strip;
URLs are clickable links (fg/2, underlined) that open in the default browser. If kept, the
description never wraps in the header; the full text lives in the editor.

### Tabs

Underline tabs, 36px: 9px state glyph + name, active tab fg/1 with a 2px fg/1 underline,
inactive fg/3. Each tab is at least 100px and at most 220px wide (name ellipsises), 4px
apart, padded 8px left and 4px right so the first glyph lines up with the title's 20px
edge (the strip is padded 12px left). Trailing + icon button for new tab. Glyph colours
follow the dot rules above. Full name in a tooltip.

No close ×. At the right end of the active tab, and of any tab under the pointer, a 18px
chevron button opens the tab menu (`TabMenu.html`). Close is in that menu and on ⌘W.

Reordering (`TabDrag.html`): press a tab and move sideways past a 4px threshold and it
lifts out of the strip as a ghost: the same glyph and name on a raised card (bg/raised a
step lighter, `#1F1F24`, 1px `#33333B` border, radius 6, 32px tall, 10px side padding, no
chevron, shadow `0 10px 24px rgba(0,0,0,.55)` plus `0 2px 4px rgba(0,0,0,.4)`), offset so
the pointer sits inside it and clamped to the strip's row; only its x follows the pointer.
The other tabs slide (120ms) to open a 100–220px slot where it will land, and that slot
shows a faint well (bg/raised, radius 6, 4px inset top and bottom) so the landing spot is
visible even when the ghost has moved on. Release drops the tab into the slot with a short
settle; Esc, or releasing outside the strip, slides it back to where it came from. While a
drag is on, no tab shows a chevron or hover state and the cursor stays the arrow. Light
theme: ghost `#FFFFFF` on a `#CFCFD6` border with a lighter shadow (`rgba(0,0,0,.18)`).

Running command: a shell tab with a command past the 5-second mark takes a filled grey
glyph (the shell colour) and the sidebar dot does the same; finished, it takes the mint ring until you
type. See Meaning under Tokens.

Muted tab: the glyph keeps its state (working, needs you, done, shell) but at 45% opacity,
and the name is fg/5. So a muted tab still tells you what Claude is doing in it; it just
no longer decides whose turn the task is. Its sidebar dot is dimmed the same way. The
tooltip adds "— muted".

### Tab menu

A plain menu under the tab (surface/2, 1px line, radius 8, 5px padding, 268px wide, 28px
rows, no help text). Rows, top to bottom:
- "Mute tab", a checkmark item (a check at the right while muted; the main menu reserves
  no check column, so labels start 10px in; the submenu keeps a 12px one for its radio check). "Mute" rather than "Park": parking is
  a task-level state with its own queue, and a muted tab simply stops asking for attention.
- "Subagents", "Background shells" and "Running commands", each showing the tab's resolved value at the right in
  fg/4 ("Wait for them" / "Ignore them") and opening a submenu of three radio items:
  "Task's setting" with the task's value as a dim suffix (e.g. "wait"), "Wait for them",
  "Ignore them". "Task's setting" is the default and stores nothing, so the tab follows the
  task. The submenu opens to the right, aligned with its row.
- "Close tab" in red (destructive) with ⌘W at the right.
No descriptions in the menu; Settings and the task editor carry the help lines.

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
  Settings" (or "Turn rules · N overrides"). Open, a help line reads "Default follows
  Settings. Tabs follow the task unless set in their menu." and three fields follow, each a three-option segmented control whose first
  option is "Default" with the resolved global value as a dim suffix (e.g. "Default · wait"):
  - Multiple Claude tabs — Default / "After one finishes" / "After all finish"
    Help: "Decides when a task with more than one Claude running becomes your turn."
  - Background subagents — Default / "Wait for them" / "Ignore them"
    Help: "Whether a task stays Claude's turn while subagents it started are still running."
  - Background shells — Default / "Wait for them" / "Ignore them"
    Help: "Whether a task stays Claude's turn while dev servers or watchers it started are
    still running."
  - Running commands — Default / "Wait for them" / "Ignore them" (Settings: Wait for them)
    Help: "Whether a task is the agent's turn while a command you ran in it runs longer than
    5 seconds."
  Default stores nothing, so the task tracks Settings. An explicit value tints its segment
  mint. The same control appears in the tab menu with "Task's setting" as the first option,
  so a tab tracks its task the same way. No override badge on rows.
- No directory field. Tabs follow the global "open in current directory" setting.

Footer: "Delete task…" (red text, left), Cancel, Save ⌘↩ (mint tint).

## Settings

Left nav (190px): Appearance, Turn rules, Tabs, Notifications & power, Keyboard shortcuts. (No Claude
Code section: the hooks are built in, so there is nothing to set.)
Header: "Settings" at the left and a Close (esc) button at the right; the Next button is
not shown while Settings is open, since Next waits until Settings closes.
Content max-width 760. Every change applies instantly; no save button. Each row is label +
optional help at left, control at right.

Appearance (`SettingsAppearance.html`)
- "Theme": segmented System / Light / Dark, default System (the section is already called Appearance). Help: "System follows macOS,
  switching between the dark and light themes chosen below."
- "Dark theme": two theme cards, Graphite (default) and Dusk. No help line; the cards show it.
- "Light theme": two theme cards, Paper (default) and Linen.
- A theme card is a radio: a 148×92 preview drawn in the theme's own colours (sidebar
  strip with three rows and their dots, header bar with a mint Next pill, tab underline,
  four lines of text), 1px line border, radius 8, name underneath in 12px. The chosen card
  has a 2px mint ring and its name is fg/1 medium; the others are fg/3. No check badge. Picking a card applies at once.
- Stored as `appearance: 'system' | 'light' | 'dark'`, `darkTheme: 'graphite' | 'dusk'`,
  `lightTheme: 'paper' | 'linen'`.

Turn rules: the same four rows and words as the editor, two options each, no "default"
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

Keyboard shortcuts
- Help line: "Click a shortcut, then press the new keys. Esc cancels." and a "Reset all"
  button.
- Two columns: Tasks; then Tabs and Terminal stacked. Rows 34px: name left, key caps right
  (mono 11px, 20px tall caps with a 2px bottom edge).
- A shortcut changed from its default shows a small grey dot before the keys; hovering a row
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

## Themes

Same layout and rules in all four; only values change (see Tokens). In the light themes
the Next button is a mint tint (`#DCEFE6` with `#0F5E44` text on Paper), never a solid
fill. `MainDusk.html`, `MainLight.html` (Paper) and `MainLinen.html` show the main window
in the three non-default themes; `SettingsLight.html` is Settings on Paper.

## Out of scope

No app icon yet. Native menus, dialogs and notifications follow macOS.
