/** @jsxImportSource react */
/**
 * Every visible string of the fake, in `en` and `es` (strategy §6.1 `locale` knob). The agent
 * never matches text (§3.9), so these may change freely; the two toasts mirror research §1 item 2.
 * Also used server-side for the login and challenge placeholders.
 *
 * `es` (AM45, live checklist L21): **every Spanish string is (unverified).** No Spanish Instagram page
 * has been seen: the saved msite bundles are logged-out English, and nothing in this repo may load
 * real Instagram from a test browser. They are plausible renderings of Instagram's controls, never quoted
 * from Instagram, and exist so the autopilot is proven against a page whose every visible string and
 * aria-label differs from English: the + link's aria-label (Instagram's Home string, by a bug of theirs:
 * `navHome`), the menu items, the Share footer, the toasts with their action, the rotate snackbar and the
 * upload dialog. E45 checks that a locale=es run sees these strings on the controls it taps and in the
 * toasts (the control and toast logs); i18n.test.ts in tools/fake-ig checks that es translates every key.
 */

export type Locale = 'en' | 'es';

export interface Strings {
  brand: string;
  navHome: string;
  navSearch: string;
  navCreate: string;
  navReels: string;
  navProfile: string;
  menuPost: string;
  menuStory: string;
  menuReel: string;
  feedPost: string;
  composerPick: string;
  composerDrop: string;
  composerLoading: string;
  share: string;
  save: string;
  close: string;
  toastRotate: string;
  toastPhotoOnly: string;
  toastDecodeFailed: string;
  toastShared: string;
  toastShareFailed: string;
  toastPostUnsupported: string;
  toastAdded: string;
  toastAddedFacebook: string;
  toastUploadFailed: string;
  retry: string;
  uploading: string;
  shareStory: string;
  text: string;
  draw: string;
  aiLabel: string;
  fbBadge: string;
  feedbackTitle: string;
  feedbackBody: string;
  ok: string;
  loginTitle: string;
  loginBody: string;
  challengeTitle: string;
  challengeBody: string;
  noticeTitle: string;
  noticeBody: string;
  /** C15: what Instagram serves a framed document request (`framed=unavailable`). */
  unavailableTitle: string;
  unavailableBody: string;
  unavailableBack: string;
}

export const STRINGS: { readonly [L in Locale]: Strings } = {
  en: {
    brand: 'fake instagram',
    navHome: 'Home',
    navSearch: 'Search',
    navCreate: 'New post',
    navReels: 'Reels',
    navProfile: 'Profile',
    menuPost: 'Post',
    menuStory: 'Story',
    menuReel: 'Reel',
    feedPost: 'Placeholder post',
    composerPick: 'Choose a photo to add to your story.',
    composerDrop: 'Or drop a photo here.',
    composerLoading: 'Preparing your story…',
    share: 'Your story',
    save: 'Save',
    close: 'Close',
    toastRotate: 'Rotate your device to add to your story.',
    toastPhotoOnly: 'Upload failed. Only images can be posted.',
    toastDecodeFailed: 'This photo could not be opened.',
    toastShared: 'Added to your story.',
    toastShareFailed: 'Your story could not be shared. Try again.',
    toastPostUnsupported: 'Posts are not part of the fake.',
    toastAdded: 'Photo added to your story.',
    toastAddedFacebook: 'Photo added to your story and Facebook.',
    toastUploadFailed: 'Upload failed.',
    retry: 'Retry',
    uploading: 'Sharing…',
    shareStory: 'Share story',
    text: 'Text',
    draw: 'Draw',
    aiLabel: 'AI info',
    fbBadge: 'Auto crosspost to Facebook',
    feedbackTitle: 'Try again later',
    feedbackBody: 'We restrict certain activity to protect our community.',
    ok: 'OK',
    loginTitle: 'Log in',
    loginBody: 'Placeholder login page of the fake. It has no form: log in is never automated.',
    challengeTitle: 'Confirm it is you',
    challengeBody: 'Placeholder challenge page of the fake. It has no form.',
    noticeTitle: 'Before you continue',
    noticeBody: 'Placeholder interstitial page of the fake. It has no form.',
    unavailableTitle: 'Sorry, this page isn’t available.',
    unavailableBody: 'Placeholder of the fake: the page Instagram serves to a framed document request.',
    unavailableBack: 'Back to Instagram',
  },
  es: {
    brand: 'instagram falso',
    navHome: 'Inicio',
    navSearch: 'Buscar',
    navCreate: 'Nueva publicación',
    navReels: 'Reels',
    navProfile: 'Perfil',
    menuPost: 'Publicación',
    menuStory: 'Historia',
    menuReel: 'Reel',
    feedPost: 'Publicación de ejemplo',
    composerPick: 'Elige una foto para añadirla a tu historia.',
    composerDrop: 'O suelta una foto aquí.',
    composerLoading: 'Preparando tu historia…',
    share: 'Tu historia',
    save: 'Guardar',
    close: 'Cerrar',
    toastRotate: 'Gira tu dispositivo para añadir contenido a tu historia.',
    toastPhotoOnly: 'Error al subir. Solo se pueden publicar imágenes.',
    toastDecodeFailed: 'No se ha podido abrir esta foto.',
    toastShared: 'Se ha añadido a tu historia.',
    toastShareFailed: 'No se ha podido compartir tu historia. Vuelve a intentarlo.',
    toastPostUnsupported: 'Las publicaciones no forman parte del falso.',
    toastAdded: 'Foto añadida a tu historia.',
    toastAddedFacebook: 'Foto añadida a tu historia y a Facebook.',
    toastUploadFailed: 'Error al subir.',
    retry: 'Reintentar',
    uploading: 'Compartiendo…',
    shareStory: 'Compartir historia',
    text: 'Texto',
    draw: 'Dibujar',
    aiLabel: 'Información de IA',
    fbBadge: 'Publicar automáticamente en Facebook',
    feedbackTitle: 'Vuelve a intentarlo más tarde',
    feedbackBody: 'Restringimos ciertas actividades para proteger a nuestra comunidad.',
    ok: 'Aceptar',
    loginTitle: 'Iniciar sesión',
    loginBody: 'Página de inicio de sesión de ejemplo. No tiene formulario: el inicio de sesión nunca se automatiza.',
    challengeTitle: 'Confirma que eres tú',
    challengeBody: 'Página de verificación de ejemplo. No tiene formulario.',
    noticeTitle: 'Antes de continuar',
    noticeBody: 'Página intermedia de ejemplo. No tiene formulario.',
    unavailableTitle: 'Lo sentimos, esta página no está disponible.',
    unavailableBody: 'Página de ejemplo del falso: la que Instagram sirve a una solicitud de documento enmarcada.',
    unavailableBack: 'Volver a Instagram',
  },
};

export const strings = (locale: Locale): Strings => STRINGS[locale];
