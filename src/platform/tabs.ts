/**
 * Thin wrapper over the tabs API. No `tabs` permission is needed: every call is by id,
 * and tab.url is only visible for hosts the extension has permission for (§3.6).
 */
import { type Browser, browser } from 'wxt/browser';

export interface TabInfo {
  id: number;
  windowId: number;
  /** undefined for hosts without permission. */
  url: string | undefined;
  /** Inner (viewport) size, used for the frame delta. */
  width: number | undefined;
  height: number | undefined;
}

export interface TabUpdate {
  status: 'loading' | 'complete' | undefined;
  url: string | undefined;
}

export interface TabsPort {
  get(tabId: number): Promise<TabInfo>;
  /** W5: tabs.getZoom (no permission needed); 1 = 100%. */
  getZoom(tabId: number): Promise<number>;
  create(url: string): Promise<TabInfo>;
  activate(tabId: number): Promise<void>;
  navigate(tabId: number, url: string): Promise<void>;
  hardReload(tabId: number): Promise<void>;
  /** One frame: the top frame (0) unless `frameId` names another (the in-page engine frame). */
  sendMessage<R = unknown>(tabId: number, message: unknown, frameId?: number): Promise<R>;
  onUpdated(listener: (tabId: number, update: TabUpdate) => void): () => void;
  onRemoved(listener: (tabId: number) => void): () => void;
}

const info = (t: Browser.tabs.Tab): TabInfo => {
  if (t.id === undefined) throw new Error('tab without id');
  return { id: t.id, windowId: t.windowId, url: t.url, width: t.width, height: t.height };
};

export const tabs: TabsPort = {
  async get(tabId) {
    return info(await browser.tabs.get(tabId));
  },
  async getZoom(tabId) {
    return await browser.tabs.getZoom(tabId);
  },
  async create(url) {
    return info(await browser.tabs.create({ url, active: true }));
  },
  async activate(tabId) {
    await browser.tabs.update(tabId, { active: true });
  },
  async navigate(tabId, url) {
    await browser.tabs.update(tabId, { url });
  },
  async hardReload(tabId) {
    await browser.tabs.reload(tabId, { bypassCache: true });
  },
  async sendMessage<R>(tabId: number, message: unknown, frameId = 0) {
    return (await browser.tabs.sendMessage(tabId, message, { frameId })) as R;
  },
  onUpdated(listener) {
    const l = (tabId: number, change: Browser.tabs.OnUpdatedInfo, tab: Browser.tabs.Tab) => {
      const status = change.status === 'loading' || change.status === 'complete' ? change.status : undefined;
      listener(tabId, { status, url: tab.url });
    };
    browser.tabs.onUpdated.addListener(l);
    return () => browser.tabs.onUpdated.removeListener(l);
  },
  onRemoved(listener) {
    const l = (tabId: number) => listener(tabId);
    browser.tabs.onRemoved.addListener(l);
    return () => browser.tabs.onRemoved.removeListener(l);
  },
};
