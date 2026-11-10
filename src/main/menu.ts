// The native menu bar. App commands carry the user's shortcuts from settings.json.

import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { commandById, type CommandId } from '../shared/commands';
import { acceleratorFor, editsText } from '../shared/shortcuts';
import type { Queue, Settings } from '../shared/model';

export interface MenuHandlers {
  command(id: CommandId): void;
  copy(): void;
  selectAll(): void;
  openSettings(): void;
}

/** What the Task and Go menus depend on. The menu is rebuilt when this changes. */
export interface MenuContext {
  /** The open task's queue, if a task is open. */
  openQueue: Queue | undefined;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Next Task is off while Settings fills the window. */
  canGoNext: boolean;
}


export function buildMenu(settings: Settings, h: MenuHandlers, ctx: MenuContext): Menu {
  const { openQueue } = ctx;
  const cmd = (id: CommandId, extra: MenuItemConstructorOptions = {}): MenuItemConstructorOptions => {
    const accelerator = acceleratorFor(settings, id);
    return {
      label: commandById(id).label,
      // A shortcut on a text-editing key (⌘←) is left off the menu: macOS would
      // take it from text fields too. The window runs it instead (see editsText).
      accelerator: accelerator && !editsText(accelerator) ? accelerator : undefined,
      click: () => h.command(id),
      ...extra,
    };
  };
  const hasTask = openQueue !== undefined;
  const tabs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => cmd(`tab${n}` as CommandId));

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: h.openSettings },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        cmd('newTask'),
        { type: 'separator' },
        cmd('newTab'),
        { type: 'separator' },
        cmd('closeTab'),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: h.copy },
        { role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: h.selectAll },
        { type: 'separator' },
        cmd('find'),
        cmd('findNext'),
        cmd('findPrevious'),
        { type: 'separator' },
        cmd('clearTerminal'),
      ],
    },
    {
      label: 'Task',
      submenu: [
        cmd('nextTask', { enabled: ctx.canGoNext }),
        { type: 'separator' },
        cmd('parkTask', { label: openQueue === 'parked' ? 'Unpark Task' : 'Park Task', enabled: hasTask }),
        cmd('markDone', { label: openQueue === 'done' ? 'Reopen Task' : 'Mark Done', enabled: hasTask }),
        { type: 'separator' },
        cmd('editTask', { enabled: hasTask }),
      ],
    },
    {
      label: 'Go',
      submenu: [
        cmd('back', { enabled: ctx.canGoBack }),
        cmd('forward', { enabled: ctx.canGoForward }),
        { type: 'separator' },
        cmd('taskAbove'),
        cmd('taskBelow'),
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(app.isPackaged
          ? []
          : ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])),
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        cmd('nextTab'),
        cmd('prevTab'),
        { type: 'separator' },
        ...tabs,
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
