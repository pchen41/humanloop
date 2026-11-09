// The native menu bar. App commands carry the user's shortcuts from settings.json.

import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { commandById, type CommandId } from '../shared/commands';
import type { HookStatus } from '../shared/hooks';
import type { Settings } from '../shared/model';

export interface MenuHandlers {
  command(id: CommandId): void;
  copy(): void;
  selectAll(): void;
  openSettings(): void;
  installHooks(): void;
  removeHooks(): void;
}

export function acceleratorFor(settings: Settings, id: CommandId): string | undefined {
  const custom = settings.shortcuts[id];
  if (custom !== undefined) return custom || undefined; // "" unbinds a shortcut
  return commandById(id).accelerator;
}

export function buildMenu(settings: Settings, h: MenuHandlers, hooks: HookStatus | 'unreadable'): Menu {
  const cmd = (id: CommandId): MenuItemConstructorOptions => ({
    label: commandById(id).label,
    accelerator: acceleratorFor(settings, id),
    click: () => h.command(id),
  });
  const tabs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => cmd(`tab${n}` as CommandId));

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: h.openSettings },
        { type: 'separator' },
        {
          label: hooks === 'outdated' ? 'Update Claude Code Hooks…' : 'Install Claude Code Hooks…',
          visible: hooks !== 'installed',
          click: h.installHooks,
        },
        { label: 'Remove Claude Code Hooks…', visible: hooks === 'installed' || hooks === 'outdated', click: h.removeHooks },
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
        cmd('clearTerminal'),
      ],
    },
    {
      label: 'Task',
      submenu: [cmd('editTask')],
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
