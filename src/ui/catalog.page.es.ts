/**
 * The in-page content script's texts in Spanish (strategy §11 AM48): neutral Spanish (tú), the same keys and
 * `{placeholders}` as `catalog.page.en.ts` (i18n.test.ts checks both, through `catalog.es.ts`).
 */
import type { PageCatalog } from './catalog.page.en.ts';

export const PAGE_ES: PageCatalog = {
  'page.entry.label': 'Nueva historia',
  'page.entry.name': 'instapost: nueva historia',
  'page.entry.tip': 'instapost · Nueva historia',
  'page.entry.posting': 'Publicando…',
  'page.entry.postingName': 'instapost: publicando en otra pestaña de Instagram. Abrir.',
  'page.entry.postingTip': 'Publicando en otra pestaña de Instagram · paso {step} de {of}',
  'page.entry.posted': 'Publicada',
  'page.entry.postedTip': 'Publicada en la historia de @{handle}',
  'page.entry.postedTipYours': 'Publicada en tu historia',
  'page.entry.notPosted': 'No publicada',
  'page.entry.notPostedTip': 'No publicada · Abre instapost para ver por qué',
  'page.entry.unknown': 'Revisa tu historia',
  'page.entry.unknownTip': 'No se pudo confirmar · Revisa tu historia',
  'page.entry.resultName': 'instapost: {label}.',
  'page.entry.paused': 'En pausa',
  'page.entry.pausedTip': 'La publicación desde el escritorio está en pausa hasta el {until}',
  'page.entry.pausedName': 'instapost: en pausa hasta el {until}. Abrir.',
  'page.coach.title': 'Publica una historia desde aquí',
  'page.coach.body': 'instapost se abre sobre Instagram, así que nunca sales de la página.',
  'page.coach.key': 'Atajo',
  'page.coach.ok': 'Entendido',
  'page.repost.add': 'Añadir a tu historia',
  'page.repost.addName': 'instapost: añadir esta publicación a tu historia',
  'page.repost.with': 'con instapost',
  'page.repost.mention': 'Añadir a tu historia',
  'page.repost.mentionName': 'instapost: añadir la historia de @{handle} a la tuya',
  'page.repost.video': 'Los vídeos llegarán más adelante',
  'page.repost.blocked': '@{handle} no permite compartir esta publicación',
  'page.repost.busy': 'Espera a que termine la publicación en curso',
  'page.repost.expired': 'Esta historia ha caducado',
};
