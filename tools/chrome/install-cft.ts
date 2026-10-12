/** Installs the pinned Chrome for Testing build into .cache/cft (strategy §7.4, S2). Idempotent. */

import { existsSync } from 'node:fs';
import { install } from '@puppeteer/browsers';
import { CFT_BUILD, cftExecutable, cftInstallOptions } from './versions.ts';

const exe = cftExecutable();
if (existsSync(exe)) {
  console.log(`CfT ${CFT_BUILD} already installed: ${exe}`);
} else {
  console.log(`Installing Chrome for Testing ${CFT_BUILD} ...`);
  const installed = await install({ ...cftInstallOptions(), downloadProgressCallback: 'default' });
  console.log(`CfT ${installed.buildId} installed: ${installed.executablePath}`);
}
