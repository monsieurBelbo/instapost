/**
 * instapost's own outline icons (inpage-ui-spec.md FE9, FR12): 24-px grid, 2-px stroke, no Instagram glyphs.
 */
import type { JSX } from 'preact';

const P = (d: string) => <path d={d} />;

const ICONS = {
  x: P('M6 6l12 12M18 6 6 18'),
  min: P('M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7'),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  back: P('M15 18l-6-6 6-6'),
  zoom: (
    <>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="m20.5 20.5-5-5M10.5 7.5v6M7.5 10.5h6" />
    </>
  ),
  fit: P('M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3'),
  safe: (
    <>
      <rect x="5" y="2.5" width="14" height="19" rx="3" />
      <path d="M5 7h14M5 17.5h14" />
    </>
  ),
  reset: P('M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 3.5v5h5'),
  rotate: P('M20.5 12a8.5 8.5 0 1 1-2.6-6.1l2.6 2.6M20.5 3.5v5h-5'),
  check: P('M5 12.5l4.5 4.5L19 7.5'),
  alert: P('M12 6.5v7M12 17.2v.3'),
  q: P('M9.2 9a2.9 2.9 0 1 1 4 2.7c-.7.3-1.2 1-1.2 1.8v.5M12 17.4v.2'),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  phone: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  download: P('M12 4v11M7 10l5 5 5-5M5 20h14'),
  history: P('M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 3.5v5h5M12 8v4l3 2'),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  kbd: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6.5 10h.01M10.5 10h.01M14.5 10h.01M17.5 10h.01M7.5 14h9" />
    </>
  ),
  flask: P('M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 15h9'),
  pause: P('M9 6v12M15 6v12'),
  grow: P('M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5'),
  shrink: P('M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7'),
  chev: P('M6 9l6 6 6-6'),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 24,
  class: cls,
}: {
  name: IconName;
  size?: 24 | 20 | 16 | 18 | 12;
  class?: string;
}) {
  return (
    <svg
      class={`i${cls ? ` ${cls}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width={size <= 16 ? 2.25 : 2}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

/** FE9: the mark, a portrait card with an up arrow and one jade dot (one mark everywhere). */
export function Mark({ size = 24 }: { size?: number }): JSX.Element {
  return (
    <svg
      class="i mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="5.25" y="2.75" width="13.5" height="18.5" rx="3.75" />
      <path d="M12 16V9.2M9.2 11.8 12 9l2.8 2.8" />
      <circle class="mark-dot" cx="18.4" cy="4.6" r="3" />
    </svg>
  );
}

/** FS1: the import glyph (two cards, a photo). */
export function DropGlyph() {
  return (
    <svg
      class="drop-glyph"
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="20" y="17" width="36" height="62" rx="8" transform="rotate(-10 38 48)" opacity=".4" />
      <rect x="36" y="14" width="40" height="68" rx="9" />
      <circle cx="50" cy="33" r="4.5" />
      <path d="M36.5 67 49 55l10 10 6-6 11 11" />
    </svg>
  );
}
