/**
 * Thin wrapper over the dNR session-rule API (strategy §3.2; mocked with vi.mock in Vitest,
 * because WXT's fakeBrowser does not implement declarativeNetRequest).
 * The core's DnrRule mirrors the API's JSON; the cast below only bridges the enum typings.
 */
import { type Browser, browser } from 'wxt/browser';
import type { DnrRule } from '../core/ig-contract/rules.ts';

export interface DnrPort {
  updateSessionRules(update: { removeRuleIds?: number[]; addRules?: DnrRule[] }): Promise<void>;
  getSessionRules(): Promise<DnrRule[]>;
}

type ApiRule = Browser.declarativeNetRequest.Rule;

export const dnr: DnrPort = {
  async updateSessionRules({ removeRuleIds = [], addRules = [] }) {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds,
      addRules: addRules as unknown as ApiRule[],
    });
  },
  async getSessionRules() {
    return (await browser.declarativeNetRequest.getSessionRules()) as unknown as DnrRule[];
  },
};
