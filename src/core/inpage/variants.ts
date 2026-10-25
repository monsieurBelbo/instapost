/**
 * The device-profile variants of the in-page lane (docs/inpage.md §3.6), on their own so the content script
 * and the panel can name them without bundling the rules (and with them the write-endpoint strings, which
 * only background.js may hold: check-bundle T3).
 *
 * `tabwide` = U3: rule 1001 on every resource type of the run's tab except `main_frame`.
 * `document` = U1: rule 1001 on `sub_frame` only (the engine frame's document).
 */
export const FRAME_UA_VARIANTS = ['tabwide', 'document'] as const;
export type FrameUaVariant = (typeof FRAME_UA_VARIANTS)[number];
