import type { CDPSession } from '@playwright/test';

/**
 * Records every network request made by the extension's own contexts — the
 * service worker, the offscreen document, extension pages and every worker
 * they start (Tesseract, export) — by attaching to each chrome-extension://
 * target over CDP and enabling the Network domain. Nested sessions use
 * Target.sendMessageToTarget so they don't interfere with Playwright's own.
 */

type Msg = { id?: number; method?: string; params?: any; result?: any; error?: any };

class Session {
  private nextId = 1;
  private pending = new Map<number, (m: Msg) => void>();
  private children = new Map<string, Session>();

  constructor(
    private readonly sendRaw: (m: Msg) => void,
    private readonly onRequest: (url: string, where: string) => void,
    readonly label: string,
  ) {}

  send(method: string, params: object = {}): Promise<Msg> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.sendRaw({ id, method, params });
    });
  }

  dispatch(m: Msg) {
    if (m.id !== undefined) {
      this.pending.get(m.id)?.(m);
      this.pending.delete(m.id);
      return;
    }
    if (m.method === 'Network.requestWillBeSent') this.onRequest(m.params.request.url, this.label);
    else if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId as string;
      const child = new Session(
        (msg) => this.send('Target.sendMessageToTarget', { sessionId: sid, message: JSON.stringify(msg) }),
        this.onRequest,
        `${this.label} > ${m.params.targetInfo.type} ${m.params.targetInfo.url}`,
      );
      this.children.set(sid, child);
      void child.init();
    } else if (m.method === 'Target.receivedMessageFromTarget') {
      this.children.get(m.params.sessionId)?.dispatch(JSON.parse(m.params.message));
    }
  }

  async init() {
    await this.send('Network.enable');
    // Child workers start paused until their own Network domain is on, so requests
    // made at startup (e.g. importScripts of the OCR engine) are recorded too.
    await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
    await this.send('Runtime.runIfWaitingForDebugger');
  }
}

export class ExtensionNetworkMonitor {
  readonly requests: { url: string; where: string }[] = [];
  private sessions = new Map<string, Session>();
  private attached = new Set<string>();

  constructor(
    private readonly browser: CDPSession,
    private readonly extId: string,
  ) {}

  async start() {
    const b = this.browser;
    b.on('Target.receivedMessageFromTarget', (e: any) => this.sessions.get(e.sessionId)?.dispatch(JSON.parse(e.message)));
    b.on('Target.targetCreated', (e: any) => void this.maybeAttach(e.targetInfo));
    b.on('Target.targetInfoChanged', (e: any) => void this.maybeAttach(e.targetInfo));
    await b.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = (await b.send('Target.getTargets')) as { targetInfos: any[] };
    await Promise.all(targetInfos.map((t) => this.maybeAttach(t)));
  }

  private async maybeAttach(t: { targetId: string; type: string; url: string }) {
    if (!t.url.startsWith(`chrome-extension://${this.extId}/`) || this.attached.has(t.targetId)) return;
    this.attached.add(t.targetId);
    const { sessionId } = (await this.browser.send('Target.attachToTarget', { targetId: t.targetId, flatten: false })) as { sessionId: string };
    const s = new Session(
      (m) => void this.browser.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify(m) }).catch(() => {}),
      (url, where) => this.requests.push({ url, where }),
      `${t.type} ${t.url}`,
    );
    this.sessions.set(sessionId, s);
    await s.init();
  }

  /** Requests that are not the extension loading its own packaged files. */
  foreign() {
    return this.requests.filter((r) => !/^(chrome-extension:\/\/|data:|blob:)/.test(r.url));
  }
}
