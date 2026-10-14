/**
 * History (ux.md §4.11, IU9): a drawer (H, `#history`) with the last 50 runs, grouped by day, with their
 * thumbnails, the pace so far, and per row: View story (Posted rows under 24 h), Check (Couldn't confirm),
 * and the ⋯ menu (Open in editor, Send to phone…, Save copy, Details; It posted / It didn't post on a
 * Couldn't confirm row).
 *
 * Test ids: `history-drawer`, `history-close`, `history-pace`, `history-row` (`data-kind`, `data-id`),
 * `history-view-story`, `history-check`, `history-more`, `history-mark-posted`, `history-mark-not-posted`.
 */
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { getExport } from '../platform/idb.ts';
import { downloadBlob, storyFilename } from '../publish/download.ts';
import { ACTION_LABEL, at, clock } from './copy.ts';
import { Details } from './Details.tsx';
import { loadImageFile } from './editor-state.ts';
import { dayLabel, type HistoryRow, historyRows, refreshHistory, thumbs } from './history.ts';
import { type MsgKey, t, tk } from './i18n.ts';
import { lane, markOutcome, openInstagram } from './run-state.ts';
import { now, openOverlay } from './ui-state.ts';

const kindText = (kind: HistoryRow['kind']): string => tk(`history.kind.${kind}` as MsgKey);

function Row({ row }: { row: HistoryRow }) {
  const more = useSignal(false);
  const time = now.value;
  const thumb = row.exportId ? thumbs.value[row.exportId] : null;
  const recentPost = row.kind === 'posted' && time - row.at < 24 * 60 * 60 * 1000;
  const save = async () => {
    if (!row.exportId) return;
    const e = await getExport(row.exportId);
    if (e) await downloadBlob(e.blob, storyFilename(new Date(), 'png'));
  };
  const open = async () => {
    if (!row.exportId) return;
    const e = await getExport(row.exportId);
    if (e) {
      await loadImageFile(e.blob);
      openOverlay(null);
    }
  };
  return (
    <li class={`history-row kind-${row.kind}`} data-testid="history-row" data-kind={row.kind} data-id={row.id}>
      <span class="history-thumb">
        {thumb ? <img class="history-img" src={thumb} alt="" /> : <span class="thumb-empty" />}
      </span>
      <span class="history-main">
        <span class="history-time">{clock(row.at)}</span> {kindText(row.kind)}
        {row.mode !== 'post' && row.mode !== 'check' && row.kind !== 'tested' && row.kind !== 'shareTested'
          ? t('history.test')
          : ''}
        {row.account ? ` · ${at(row.account)}` : ''}
        {row.durationMs !== null && row.kind === 'posted'
          ? t('history.seconds', { s: Math.round(row.durationMs / 1000) })
          : ''}
        {row.marked ? t('history.marked') : ''}
      </span>
      <span class="history-actions">
        {recentPost && row.account && (
          <button
            type="button"
            class="link"
            data-testid="history-view-story"
            onClick={() => openInstagram('story', row.account)}
          >
            {t('history.viewStory')}
          </button>
        )}
        {row.kind === 'unknown' && (
          <button
            type="button"
            class="link"
            data-testid="history-check"
            onClick={() => openInstagram(row.account ? 'story' : 'home', row.account)}
          >
            {t('history.check')}
          </button>
        )}
        <button
          type="button"
          class="link"
          data-testid="history-more"
          aria-expanded={more.value}
          onClick={() => {
            more.value = !more.value;
          }}
        >
          ⋯
        </button>
      </span>
      {more.value && (
        <div class="history-more">
          {row.exportId && (
            <>
              <button type="button" class="link" onClick={() => void open()}>
                {t('history.open')}
              </button>
              <button type="button" class="link" onClick={() => void save()}>
                {ACTION_LABEL.saveCopy}
              </button>
            </>
          )}
          {row.kind === 'unknown' && (
            <>
              <button
                type="button"
                class="link"
                data-testid="history-mark-posted"
                onClick={() => {
                  markOutcome(row.id, true);
                  setTimeout(() => void refreshHistory(), 300);
                }}
              >
                {ACTION_LABEL.markPosted}
              </button>
              <button
                type="button"
                class="link"
                data-testid="history-mark-not-posted"
                onClick={() => {
                  markOutcome(row.id, false);
                  setTimeout(() => void refreshHistory(), 300);
                }}
              >
                {ACTION_LABEL.markNotPosted}
              </button>
            </>
          )}
          <Details
            input={{
              handoffId: row.id,
              mode: row.mode === 'probe' ? 'check' : row.mode,
              result: row.result,
              code: row.code,
            }}
          />
        </div>
      )}
    </li>
  );
}

export function HistoryDrawer() {
  useEffect(() => {
    void refreshHistory();
  }, []);
  const rows = historyRows.value;
  const l = lane.value;
  const time = now.value;
  const groups: { label: string; rows: HistoryRow[] }[] = [];
  for (const r of rows) {
    const label = dayLabel(r.at, time);
    const g = groups.at(-1);
    if (g && g.label === label) g.rows.push(r);
    else groups.push({ label, rows: [r] });
  }
  return (
    <div class="overlay">
      <button
        type="button"
        class="sheet-backdrop"
        aria-label={t('common.close')}
        tabIndex={-1}
        onClick={() => openOverlay(null)}
      />
      <aside class="drawer" data-testid="history-drawer" aria-labelledby="history-title" role="dialog">
        <header class="sheet-head">
          <h1 id="history-title">{t('history.title')}</h1>
          {l && (
            <span class="hint" data-testid="history-pace">
              {t('history.pace', { today: l.today, day: l.caps.day, hour: l.hour, hourCap: l.caps.hour })}
            </span>
          )}
          <button
            type="button"
            class="link"
            data-testid="history-close"
            aria-label={t('common.close')}
            onClick={() => openOverlay(null)}
          >
            ✕
          </button>
        </header>
        {rows.length === 0 && <p class="hint">{t('history.empty')}</p>}
        {groups.map((g) => (
          <section key={g.label}>
            <h2>{g.label}</h2>
            <ul class="history-list">
              {g.rows.map((r) => (
                <Row key={r.id} row={r} />
              ))}
            </ul>
          </section>
        ))}
      </aside>
    </div>
  );
}
