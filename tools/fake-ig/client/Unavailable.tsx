/** @jsxImportSource react */
/**
 * C15 (`framed=unavailable`; live, Arc, 2026-10-14): the page Instagram serves to a logged-in document request
 * it sees as framed (`Sec-Fetch-Dest: iframe`): "Sorry, this page isn't available" with a link home, and
 * nothing else. No header (so no + entry and no story input), no navigation (so no account link), whatever the
 * shell. The in-page lane gets it when rule 1021 is left out, and must stop cleanly (FRAME_REFUSED).
 */
import type { FakeBoot } from '../protocol.ts';
import type { Strings } from './i18n.ts';
import { useCx } from './styles.ts';

export function Unavailable({ boot, t }: { boot: FakeBoot; t: Strings }) {
  const c = useCx();
  return (
    <div className={c('app')} data-fake-layout="unavailable" data-fake-shell={boot.shell}>
      <main style={{ padding: '40px 20px', maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ fontSize: 22, margin: '0 0 16px' }}>{t.unavailableTitle}</h2>
        <p style={{ margin: '0 0 12px', color: '#737373' }}>{t.unavailableBody}</p>
        <a href="/">{t.unavailableBack}</a>
      </main>
    </div>
  );
}
