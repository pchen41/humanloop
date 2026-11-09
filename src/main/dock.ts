// The Dock badge, notifications and keep-awake: how Humanloop gets your
// attention or keeps going while you're elsewhere.

import { app, Notification, powerSaveBlocker } from 'electron';

/** The Your Turn count on the Dock icon; nothing when it's zero. */
export function setDockBadge(count: number): void {
  app.dock?.setBadge(count > 0 ? String(count) : '');
}

let blocker: number | undefined;

/**
 * Stops the Mac from idle-sleeping while `on`, so Claude keeps working when
 * you step away. Closing the lid still sleeps it; macOS doesn't let apps
 * prevent that.
 */
export function keepAwake(on: boolean): void {
  if (on && blocker === undefined) {
    blocker = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!on && blocker !== undefined) {
    powerSaveBlocker.stop(blocker);
    blocker = undefined;
  }
}

/** Shown notifications by task, kept so they aren't garbage collected (which drops their click handler). */
const shown = new Map<string, Notification>();

/** One notification per task: a newer one replaces the task's previous notification. */
export function notify(taskId: string, title: string, body: string, onClick: () => void): void {
  if (!Notification.isSupported()) return;
  shown.get(taskId)?.close();
  const n = new Notification({ title, body });
  const forget = () => {
    if (shown.get(taskId) === n) shown.delete(taskId);
  };
  n.on('click', () => {
    forget();
    onClick();
  });
  n.on('close', forget);
  shown.set(taskId, n);
  n.show();
}

/** Closes a task's notification, e.g. once you've opened the task. */
export function dismissNotification(taskId: string): void {
  const n = shown.get(taskId);
  if (!n) return;
  shown.delete(taskId);
  n.close();
}
