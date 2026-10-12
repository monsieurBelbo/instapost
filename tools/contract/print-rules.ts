/**
 * Prints the write-block rules generated from src/core (offline; touches no network).
 *   node tools/contract/print-rules.ts            → static block_ig_writes ruleset
 *   node tools/contract/print-rules.ts <tabId>    → rehearsal session rules for that tab
 *
 * Also the S9 check: Node 22.18 runs a tools/*.ts file that imports src/core modules with
 * explicit .ts extensions (value and type-only imports, and a JSON import).
 */
import baseline from '../../src/core/ig-contract/baseline.json' with { type: 'json' };
import type { Baseline } from '../../src/core/ig-contract/contract.ts';
import { blockRuleset, type DnrRule, rehearsalRules, SESSION_RULE_IDS } from '../../src/core/ig-contract/rules.ts';

const arg = process.argv[2];
const rules: DnrRule[] = arg === undefined ? blockRuleset() : rehearsalRules(Number.parseInt(arg, 10));
const b: Baseline = baseline as Baseline;
console.log(JSON.stringify(rules, null, 2));
console.error(
  `${rules.length} rules; session id range ${SESSION_RULE_IDS[0]}..${SESSION_RULE_IDS.at(-1)}; baseline capturedAt=${b.capturedAt}`,
);
