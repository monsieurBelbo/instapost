/** @jsxImportSource react */
/**
 * Entry of the fake's React 19 client (strategy §6.2), bundled in memory by esbuild when the
 * server starts. Reads the boot JSON the server embedded, applies the `drift`, `locale` and
 * `sw` knobs, and mounts the msite or desktop shell with createRoot (React root delegation,
 * research §5.5).
 */
import { createRoot } from 'react-dom/client';
import type { FakeBoot } from '../protocol.ts';
import { DesktopShell } from './DesktopShell.tsx';
import { strings } from './i18n.ts';
import { MsiteShell } from './MsiteShell.tsx';
import { CxContext, plainCx, renamedCx, stylesheet } from './styles.ts';
import { syncServiceWorker } from './sw.ts';

function readBoot(): FakeBoot {
  const el = document.querySelector('script[type="application/json"][data-fake-boot]');
  const boot = JSON.parse(el?.textContent || 'null') as FakeBoot | null;
  if (boot?.v !== 1) throw new Error('fake-ig: boot data missing; the client only runs inside a fake shell');
  return boot;
}

const boot = readBoot();
const cx = boot.knobs.drift === 'renamed' ? renamedCx() : plainCx;
const style = document.createElement('style');
style.textContent = stylesheet(cx);
document.head.append(style);
void syncServiceWorker(boot.knobs.sw, boot.shell === 'msite');

const t = strings(boot.knobs.locale);
const rootEl = document.getElementById(boot.rootId);
if (!rootEl) throw new Error(`fake-ig: root #${boot.rootId} missing`);
createRoot(rootEl).render(
  <CxContext.Provider value={cx}>
    {boot.shell === 'msite' ? <MsiteShell boot={boot} t={t} /> : <DesktopShell boot={boot} t={t} />}
  </CxContext.Provider>,
);
