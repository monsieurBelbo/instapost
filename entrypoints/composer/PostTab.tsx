/**
 * The repost's first tab (docs/repost.md RP-29): Post (or Story for a mention) instead of Photo. Look
 * (posts: Card · Photo · Dark), Background (Colours · Blur · Black), Size, Show @handle (the owner's own posts
 * only: anyone else's content always carries the credit, AM56) and Reset; under them, always, that the story
 * is a photo people can't tap through and, for anyone else's content, that the author is not notified. Others' posts get a one-time note about the author's sharing settings
 * (storage.local `repostNoteSeen`).
 */
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { SCALE_RANGE } from '../../src/core/repost/card-layout.ts';
import { REPOST_BGS, type RepostBg } from '../../src/core/repost/edit.ts';
import { composerStrings as S } from '../../src/inpage/strings.ts';
import {
  repost,
  repostScale,
  resetRepost,
  setRepostBg,
  setRepostCredit,
  setRepostLook,
  setRepostScale,
} from '../../src/ui/repost-state.ts';
import { Icon } from './icons.tsx';

export const NOTE_SEEN_KEY = 'repostNoteSeen';

const pct = (v: number, min: number, max: number) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;

function ConsentNote({ handle }: { handle: string }) {
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    void browser.storage.local
      .get(NOTE_SEEN_KEY)
      .then((got) => setSeen(got[NOTE_SEEN_KEY] === true))
      .catch(() => setSeen(false));
  }, []);
  if (seen) return null;
  return (
    <div class="note rp-consent" role="note" data-testid="repost-consent">
      <Icon name="info" size={20} />
      <div>
        <span>{S.repost.consent(handle)}</span>
        <button
          type="button"
          class="tlink sm"
          onClick={() => {
            setSeen(true);
            void browser.storage.local.set({ [NOTE_SEEN_KEY]: true }).catch(() => undefined);
          }}
        >
          {S.repost.consentOk}
        </button>
      </div>
    </div>
  );
}

const BG_LABEL: Readonly<Record<RepostBg, () => string>> = {
  colours: () => S.repost.bgColours,
  blur: () => S.repost.bgBlur,
  black: () => S.repost.bgBlack,
};

export function PostTab() {
  const r = repost.value;
  if (!r) return null;
  const post = r.src.kind === 'post';
  const range = SCALE_RANGE[r.src.kind];
  const u = repostScale.value;
  const lo = Math.round(range.min * 100);
  const hi = Math.round(range.max * 100);
  return (
    <div role="tabpanel" id="pan-photo" aria-labelledby="tab-photo" data-testid="repost-tab">
      {post && !r.own && <ConsentNote handle={r.src.author} />}
      {post && (
        <div class="field">
          <span class="field-l">{S.repost.look}</span>
          <fieldset class="seg" aria-label={S.repost.look} data-testid="repost-look">
            {(
              [
                ['card', S.repost.lookCard],
                ['photo', S.repost.lookPhoto],
                ['dark', S.repost.lookDark],
              ] as const
            ).map(([style, label]) => (
              <button
                key={style}
                type="button"
                aria-pressed={r.look.style === style}
                onClick={() => setRepostLook(style)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </div>
      )}
      <div class="field">
        <span class="field-l">{S.repost.bg}</span>
        <fieldset class="seg" aria-label={S.repost.bg} data-testid="repost-bg">
          {REPOST_BGS.map((bg) => (
            <button key={bg} type="button" aria-pressed={r.look.bg === bg} onClick={() => setRepostBg(bg)}>
              {BG_LABEL[bg]()}
            </button>
          ))}
        </fieldset>
      </div>
      <label class="field">
        <span class="field-l">
          {S.repost.size} <span class="v">{Math.round(u * 100)}%</span>
        </span>
        <input
          class="range"
          type="range"
          min={lo}
          max={hi}
          step={1}
          value={Math.round(u * 100)}
          style={{ '--p': pct(u * 100, lo, hi) }}
          onInput={(e) => setRepostScale(Number((e.currentTarget as HTMLInputElement).value) / 100)}
        />
      </label>
      {post && r.own && (
        <label class="opt">
          <input
            type="checkbox"
            checked={r.look.credit}
            data-testid="repost-credit"
            onChange={(e) => setRepostCredit((e.currentTarget as HTMLInputElement).checked)}
          />
          <span>{S.repost.credit(r.src.author)}</span>
        </label>
      )}
      <button type="button" class="tlink" onClick={resetRepost}>
        {S.repost.reset}
      </button>
      {r.lowRes && !post && <p class="hint-line">{S.repost.lowRes}</p>}
      <p class="hint-line" data-testid="repost-note">
        {S.repost.note(post ? 'post' : 'mention', post && r.own, r.src.author)}
      </p>
    </div>
  );
}
