// App commands that have keyboard shortcuts. The main process builds the
// native menu from this list; the renderer carries the commands out.

export type CommandId =
  | 'newTask'
  | 'editTask'
  | 'newTab'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'tab1'
  | 'tab2'
  | 'tab3'
  | 'tab4'
  | 'tab5'
  | 'tab6'
  | 'tab7'
  | 'tab8'
  | 'tab9'
  | 'clearTerminal'
  | 'find'
  | 'findNext'
  | 'findPrevious'
  | 'nextTask'
  | 'back'
  | 'forward'
  | 'parkTask'
  | 'markDone';

export interface CommandDef {
  id: CommandId;
  label: string;
  /** Electron accelerator. Users override these in settings.json under "shortcuts". */
  accelerator: string;
}

const tabCommands: CommandDef[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
  id: `tab${n}` as CommandId,
  label: n === 9 ? 'Show Last Tab' : `Show Tab ${n}`,
  accelerator: `CmdOrCtrl+${n}`,
}));

export const COMMANDS: CommandDef[] = [
  { id: 'newTask', label: 'New Task…', accelerator: 'CmdOrCtrl+N' },
  { id: 'editTask', label: 'Edit Task…', accelerator: 'CmdOrCtrl+E' },
  { id: 'newTab', label: 'New Tab', accelerator: 'CmdOrCtrl+T' },
  { id: 'closeTab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W' },
  { id: 'nextTab', label: 'Show Next Tab', accelerator: 'CmdOrCtrl+Shift+]' },
  { id: 'prevTab', label: 'Show Previous Tab', accelerator: 'CmdOrCtrl+Shift+[' },
  ...tabCommands,
  { id: 'clearTerminal', label: 'Clear Terminal', accelerator: 'CmdOrCtrl+K' },
  { id: 'find', label: 'Find…', accelerator: 'CmdOrCtrl+F' },
  { id: 'findNext', label: 'Find Next', accelerator: 'CmdOrCtrl+G' },
  { id: 'findPrevious', label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G' },
  { id: 'nextTask', label: 'Next Task', accelerator: 'CmdOrCtrl+Return' },
  { id: 'back', label: 'Back', accelerator: 'CmdOrCtrl+[' },
  { id: 'forward', label: 'Forward', accelerator: 'CmdOrCtrl+]' },
  // The menu says Unpark / Reopen when the open task is already parked or done.
  { id: 'parkTask', label: 'Park Task', accelerator: 'CmdOrCtrl+Shift+P' },
  { id: 'markDone', label: 'Mark Done…', accelerator: 'CmdOrCtrl+Shift+D' },
];

/** How the settings screen groups the commands. Every command appears once. */
export const COMMAND_GROUPS: { title: string; ids: CommandId[] }[] = [
  { title: 'Tasks', ids: ['nextTask', 'back', 'forward', 'newTask', 'editTask', 'parkTask', 'markDone'] },
  {
    title: 'Tabs',
    ids: ['newTab', 'closeTab', 'nextTab', 'prevTab', 'tab1', 'tab2', 'tab3', 'tab4', 'tab5', 'tab6', 'tab7', 'tab8', 'tab9'],
  },
  { title: 'Terminal', ids: ['find', 'findNext', 'findPrevious', 'clearTerminal'] },
];

export const COMMAND_IDS: ReadonlySet<string> = new Set(COMMANDS.map((c) => c.id));

export function commandById(id: CommandId): CommandDef {
  const def = COMMANDS.find((c) => c.id === id);
  if (!def) throw new Error(`unknown command ${id}`);
  return def;
}
