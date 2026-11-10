// Exposes a typed, minimal API to the renderer. The renderer never sees ipcRenderer itself.

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, TERMINAL_EDIT, type HumanloopApi } from '../shared/ipc';

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: HumanloopApi = {
  getInitialData: () => ipcRenderer.invoke(IPC.getInitialData),
  onState: (cb) => listen(IPC.state, cb),
  onSettings: (cb) => listen(IPC.settings, cb),
  onCommand: (cb) => listen(IPC.command, cb),
  onAgents: (cb) => listen(IPC.agents, cb),
  onCommands: (cb) => listen(IPC.commands, cb),
  onHooks: (cb) => listen(IPC.hooks, cb),
  onShowSettings: (cb) => listen(IPC.showSettings, cb),
  openSettings: () => ipcRenderer.send(IPC.openSettings),
  settingsShown: (open) => ipcRenderer.send(IPC.settingsShown, open),
  onResume: (cb) => listen(IPC.resume, cb),
  resumeSession: (tabId) => ipcRenderer.invoke(IPC.resumeSession, tabId),
  dismissResume: (tabId) => ipcRenderer.send(IPC.dismissResume, tabId),
  recordShortcut: () => ipcRenderer.invoke(IPC.recordShortcut),
  stopRecording: () => ipcRenderer.send(IPC.stopRecording),
  setShortcut: (id, value, takeFrom) => ipcRenderer.invoke(IPC.setShortcut, id, value, takeFrom),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  openSettingsFile: () => ipcRenderer.send(IPC.openSettingsFile),

  createTask: (draft) => ipcRenderer.invoke(IPC.createTask, draft),
  updateTask: (id, patch) => ipcRenderer.invoke(IPC.updateTask, id, patch),
  openTask: (id) => ipcRenderer.invoke(IPC.openTask, id),
  nextTask: () => ipcRenderer.invoke(IPC.nextTask),
  goBack: () => ipcRenderer.invoke(IPC.goBack),
  goForward: () => ipcRenderer.invoke(IPC.goForward),
  toggleParked: () => ipcRenderer.invoke(IPC.toggleParked),
  toggleDone: () => ipcRenderer.invoke(IPC.toggleDone),
  deleteTask: (id) => ipcRenderer.invoke(IPC.deleteTask, id),
  showTaskMenu: (id, at) => ipcRenderer.send(IPC.taskMenu, id, at),
  onEditTask: (cb) => listen(IPC.editTask, cb),
  chooseDirectory: (current) => ipcRenderer.invoke(IPC.chooseDirectory, current),

  newTab: (taskId, fromTabId) => ipcRenderer.invoke(IPC.newTab, taskId, fromTabId),
  closeTab: (tabId) => ipcRenderer.invoke(IPC.closeTab, tabId),
  moveTab: (tabId, index) => ipcRenderer.invoke(IPC.moveTab, tabId, index),
  showTabMenu: (tabId, at, active) => ipcRenderer.invoke(IPC.tabMenu, tabId, at, active === true),
  onCloseTabFromMenu: (cb) => listen(IPC.closeTabFromMenu, cb),

  ptyAttach: (tabId, cols, rows, restart) => ipcRenderer.invoke(IPC.ptyAttach, tabId, cols, rows, restart === true),
  ptyWrite: (tabId, data) => ipcRenderer.send(IPC.ptyWrite, tabId, data),
  ptyWriteBinary: (tabId, data) => ipcRenderer.send(IPC.ptyWriteBinary, tabId, data),
  ptyResize: (tabId, cols, rows) => ipcRenderer.send(IPC.ptyResize, tabId, cols, rows),
  ptyAck: (tabId, chars) => ipcRenderer.send(IPC.ptyAck, tabId, chars),
  onPtyData: (cb) => listen(IPC.ptyData, cb),
  onPtyExit: (cb) => listen(IPC.ptyExit, cb),

  pageEdit: (cmd) => ipcRenderer.send(IPC.pageEdit, cmd),
  onTerminalEdit: (cb) => listen(TERMINAL_EDIT, cb),
  writeClipboard: (text) => ipcRenderer.send(IPC.clipboard, text),
  pathsForFiles: (files) => files.map((f) => webUtils.getPathForFile(f)).filter(Boolean),
};

contextBridge.exposeInMainWorld('humanloop', api);

// Tell main when this page goes away (a reload), so it stops sending terminal output here.
window.addEventListener('pagehide', () => ipcRenderer.send(IPC.unload));
