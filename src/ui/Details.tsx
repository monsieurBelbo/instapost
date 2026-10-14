/**
 * Details (ux.md §4.13, IU6): one component for the run view, the results and History. Collapsed by
 * default; Copy diagnostics copies the record's structural facts as JSON. Rows carry `data-row`.
 */
import { useSignal } from '@preact/signals';
import { type DetailInput, detailRows, diagnosticsJson } from './details.ts';

export function Details({ input, label = 'Details' }: { input: DetailInput; label?: string }) {
  const open = useSignal(false);
  const copied = useSignal(false);
  const rows = detailRows(input);
  if (rows.length === 0) return null;
  const copy = () => {
    navigator.clipboard
      .writeText(diagnosticsJson(input))
      .then(() => {
        copied.value = true;
        setTimeout(() => {
          copied.value = false;
        }, 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div class="details" data-testid="details" data-open={open.value ? 'true' : 'false'}>
      <button
        type="button"
        class="link details-toggle"
        aria-expanded={open.value}
        onClick={() => {
          open.value = !open.value;
        }}
      >
        {label} {open.value ? '▾' : '▸'}
      </button>
      {open.value && (
        <>
          <dl class="detail-rows">
            {rows.map((r) => (
              <div class="detail-row" key={r.key}>
                <dt>{r.label}</dt>
                <dd data-row={r.key}>{r.value}</dd>
              </div>
            ))}
          </dl>
          <button type="button" class="link" data-testid="details-copy" onClick={copy}>
            {copied.value ? 'Copied' : 'Copy diagnostics'}
          </button>
        </>
      )}
    </div>
  );
}
