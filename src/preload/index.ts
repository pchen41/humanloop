// Exposes a typed, minimal API to the renderer. The renderer never sees ipcRenderer itself.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
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
  onHooks: (cb) => listen(IPC.hooks, cb),
  onShowSettings: (cb) => listen(IPC.showSettings, cb),
  onResume: (cb) => listen(IPC.resume, cb),
  resumeSession: (tabId) => ipcRenderer.invoke(IPC.resumeSession, tabId),
  dismissResume: (tabId) => ipcRenderer.send(IPC.dismissResume, tabId),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  openSettingsFile: () => ipcRenderer.send(IPC.openSettingsFile),
  installHooks: () => ipcRenderer.invoke(IPC.installHooks),
  removeHooks: () => ipcRenderer.invoke(IPC.removeHooks),

  createTask: (draft) => ipcRenderer.invoke(IPC.createTask, draft),
  updateTask: (id, patch) => ipcRenderer.invoke(IPC.updateTask, id, patch),
  deleteTask: (id) => ipcRenderer.invoke(IPC.deleteTask, id),
  openTask: (id) => ipcRenderer.invoke(IPC.openTask, id),
  nextTask: () => ipcRenderer.invoke(IPC.nextTask),
  goBack: () => ipcRenderer.invoke(IPC.goBack),
  goForward: () => ipcRenderer.invoke(IPC.goForward),
  toggleParked: () => ipcRenderer.invoke(IPC.toggleParked),
  toggleDone: () => ipcRenderer.invoke(IPC.toggleDone),
  showTaskMenu: (id) => ipcRenderer.send(IPC.taskMenu, id),
  onEditTask: (cb) => listen(IPC.editTask, cb),
  chooseDirectory: (current) => ipcRenderer.invoke(IPC.chooseDirectory, current),

  newTab: (taskId) => ipcRenderer.invoke(IPC.newTab, taskId),
  closeTab: (tabId) => ipcRenderer.invoke(IPC.closeTab, tabId),
  setTabTitle: (tabId, title) => ipcRenderer.send(IPC.setTabTitle, tabId, title),

  ptyAttach: (tabId, cols, rows) => ipcRenderer.invoke(IPC.ptyAttach, tabId, cols, rows),
  ptyWrite: (tabId, data) => ipcRenderer.send(IPC.ptyWrite, tabId, data),
  ptyResize: (tabId, cols, rows) => ipcRenderer.send(IPC.ptyResize, tabId, cols, rows),
  ptyAck: (tabId, chars) => ipcRenderer.send(IPC.ptyAck, tabId, chars),
  onPtyData: (cb) => listen(IPC.ptyData, cb),
  onPtyExit: (cb) => listen(IPC.ptyExit, cb),

  setTerminalFocused: (focused) => ipcRenderer.send(IPC.terminalFocus, focused),
  onTerminalEdit: (cb) => listen(TERMINAL_EDIT, cb),
  writeClipboard: (text) => ipcRenderer.send(IPC.clipboard, text),
};

contextBridge.exposeInMainWorld('humanloop', api);
