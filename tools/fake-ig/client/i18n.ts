/** @jsxImportSource react */
/**
 * Every visible string of the fake, in `en` and `es` (strategy §6.1 `locale` knob). The agent
 * never matches text (§3.9), so these may change freely; the two toasts mirror research §1 item 2.
 * Also used server-side for the login and challenge placeholders.
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
  loginTitle: string;
  loginBody: string;
  challengeTitle: string;
  challengeBody: string;
  noticeTitle: string;
  noticeBody: string;
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
    loginTitle: 'Log in',
    loginBody: 'Placeholder login page of the fake. It has no form: log in is never automated.',
    challengeTitle: 'Confirm it is you',
    challengeBody: 'Placeholder challenge page of the fake. It has no form.',
    noticeTitle: 'Before you continue',
    noticeBody: 'Placeholder interstitial page of the fake. It has no form.',
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
    loginTitle: 'Iniciar sesión',
    loginBody: 'Página de inicio de sesión de ejemplo. No tiene formulario: el inicio de sesión nunca se automatiza.',
    challengeTitle: 'Confirma que eres tú',
    challengeBody: 'Página de verificación de ejemplo. No tiene formulario.',
    noticeTitle: 'Antes de continuar',
    noticeBody: 'Página intermedia de ejemplo. No tiene formulario.',
  },
};

export const strings = (locale: Locale): Strings => STRINGS[locale];
