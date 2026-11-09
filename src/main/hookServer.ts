// Receives Claude Code hook events over a Unix socket. Each tab's shell gets
// the socket path in HUMANLOOP_SOCK; the hook command posts the event JSON
// with the tab id (X-Tab) and the posting claude process id (X-Pid).

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** macOS limits Unix socket paths to 104 bytes. */
const MAX_SOCKET_PATH = 100;
/** Tool results can be large; anything bigger is cut off and ignored. */
const MAX_BODY = 8 * 1024 * 1024;

export interface HookDelivery {
  tabId: string;
  pid: number | undefined;
  event: Record<string, unknown>;
}

export function hookSocketPath(userData: string): string {
  const preferred = join(userData, 'hook.sock');
  if (Buffer.byteLength(preferred) <= MAX_SOCKET_PATH) return preferred;
  // Hash the data folder so separate instances (e.g. dev and installed) never share a socket.
  const hash = createHash('sha256').update(userData).digest('hex').slice(0, 12);
  return join(tmpdir(), `humanloop-${hash}.sock`);
}

export class HookServer {
  private server: Server | undefined;

  constructor(
    readonly path: string,
    private onEvent: (d: HookDelivery) => void,
  ) {}

  /** Starts listening. A socket left by a crashed run is removed first (the single-instance lock means it isn't ours). */
  start(): Promise<void> {
    if (existsSync(this.path)) unlinkSync(this.path);
    const server = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
      });
      req.on('end', () => {
        // Answer at once with no body: hook stdout is read by Claude, and the hook should never wait on us.
        res.writeHead(204).end();
        if (size > MAX_BODY) return;
        const tabId = req.headers['x-tab'];
        const pid = Number(req.headers['x-pid']);
        if (typeof tabId !== 'string' || !tabId) return;
        let event: unknown;
        try {
          event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return;
        }
        if (typeof event !== 'object' || event === null || Array.isArray(event)) return;
        this.onEvent({ tabId, pid: Number.isInteger(pid) && pid > 0 ? pid : undefined, event: event as Record<string, unknown> });
      });
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.path, () => {
        server.off('error', reject);
        try {
          chmodSync(this.path, 0o600); // only you can post events
        } catch {
          // the folder is already private to you
        }
        resolve();
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
    try {
      if (existsSync(this.path)) unlinkSync(this.path);
    } catch {
      // ignore
    }
  }
}
