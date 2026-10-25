/**
 * The repost's intake in the stage area (docs/repost.md RP-20, RP-22), where the import view goes: loading
 * (the author's handle and a spinner), the permission card (Allow, or Allow in instapost's settings when the
 * browser would not ask from the framed composer), denied, the expired link and the failure (Try again).
 * Choose photo… is always there as the way out, and ✕ cancels the repost.
 */
import type { JSX } from 'preact';
import { composerStrings as S } from '../../src/inpage/strings.ts';
import { allowCdn, cancelIntake, intake, retryIntake } from '../../src/ui/repost-state.ts';
import { pickPhoto } from './actions.ts';
import { Icon, Mark } from './icons.tsx';
import { send } from './state.ts';

export function RepostIntake() {
  const it = intake.value;
  if (!it) return null;
  const h = it.src.author;
  const story = it.src.kind === 'mention';
  const choose = (
    <button type="button" class="btn secondary" id="choose" onClick={pickPhoto}>
      {S.import.choose}
    </button>
  );
  let body: JSX.Element;
  switch (it.state) {
    case 'loading':
      body = (
        <div class="rp-in" role="status" data-testid="repost-loading">
          <span class="rp-av" aria-hidden="true">
            {h.slice(0, 1).toUpperCase()}
          </span>
          <p class="rp-t">
            <i class="spinner" />
            {story ? S.repost.loadingStory(h) : S.repost.loadingPost(h)}
          </p>
        </div>
      );
      break;
    case 'permission':
      body = (
        <div class="rp-in" data-testid="repost-permission">
          <span class="rp-mark" aria-hidden="true">
            <Mark />
          </span>
          <p class="rp-t">{S.repost.permTitle}</p>
          <p class="rp-b">{S.repost.permBody}</p>
          <div class="rp-a">
            {it.settingsRoute ? (
              <button
                type="button"
                class="btn primary"
                data-testid="repost-settings"
                onClick={() => send({ v: 1, type: 'ui/open-settings' })}
              >
                {S.repost.permSettings}
              </button>
            ) : (
              <button type="button" class="btn primary" data-testid="repost-allow" onClick={() => void allowCdn()}>
                {S.repost.permAllow}
              </button>
            )}
            {choose}
          </div>
        </div>
      );
      break;
    case 'denied':
      body = (
        <div class="rp-in" data-testid="repost-denied">
          <p class="rp-b">{S.repost.permDenied}</p>
          <div class="rp-a">{choose}</div>
        </div>
      );
      break;
    case 'expired':
      body = (
        <div class="rp-in" data-testid="repost-expired" role="alert">
          <p class="rp-b">{S.repost.expiredLink}</p>
          <div class="rp-a">{choose}</div>
        </div>
      );
      break;
    default:
      body = (
        <div class="rp-in" data-testid="repost-failed" role="alert">
          <p class="rp-b">{S.repost.failed}</p>
          <div class="rp-a">
            <button type="button" class="btn primary" data-testid="repost-retry" onClick={retryIntake}>
              {S.repost.tryAgain}
            </button>
            {choose}
          </div>
        </div>
      );
  }
  return (
    <div class="import rp-intake" data-state={it.state}>
      <button
        type="button"
        class="icon-btn rp-x"
        aria-label={S.repost.cancel}
        data-tip={S.repost.cancel}
        data-testid="repost-cancel"
        onClick={cancelIntake}
      >
        <Icon name="x" />
      </button>
      {body}
    </div>
  );
}
