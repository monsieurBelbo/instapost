/**
 * The site's Spanish words: neutral Latin American Spanish (tú, no vos, no region-only words), the product's own terms
 * from src/ui/catalog.es.ts and catalog.page.es.ts (Nueva historia, Publicar historia, Hacer la prueba inicial,
 * Compartir, No se pudo confirmar, Copiar diagnóstico, Ajustes, borrador, Fotos recientes, stickers, video).
 * Chrome's own labels were read from Chromium's translations: es-419 "Cargar extensión sin empaquetar", es "Cargar
 * descomprimida", "Modo de desarrollador" / "Modo Desarrollador", "Quitar", "Volver a cargar", "Leer y modificar tus
 * datos", "Administrar tus descargas" (es-419; es says "Gestionar"). "Doomscroll" stays: it's the owner's word. A repost
 * is "republicar" here: the product's "volver a publicar" means posting your own again.
 */
import type { Copy } from './copy.en.ts';

export const ES: Copy = {
  lang: 'es',
  locale: 'es_LA',
  otherLang: { label: 'English', hreflang: 'en' },
  title: 'instapost: publica historias de Instagram desde tu computadora',
  description:
    'Una extensión de navegador gratis que añade Nueva historia a Instagram en la web. Solo fotos, se instala a mano y se usa bajo tu propio riesgo. Sin afiliación con Instagram.',
  ogAlt: 'Deja el teléfono. Sube tu historia. instapost: publica historias con foto en Instagram desde tu computadora.',
  h1: ['Deja el', 'teléfono.', 'Sube tu', 'historia.'],
  sub: 'Publica historias con foto en Instagram desde tu computadora.',
  kind: 'Una extensión gratis para Arc y Chrome.',
  phone: 'Entra desde una computadora.',
  download: 'Descargar {v}',
  downloadMeta: '{size}. Solo fotos.',
  prerelease: 'Versión preliminar.',
  noRelease: 'Aún no hay descarga.',
  risk: 'Funciona fuera de los términos de Instagram: tu cuenta, tu riesgo. Prueba antes con una secundaria.',
  entry: 'Nueva historia',
  shotAlt:
    'La ventana de instapost. A la izquierda, la foto de un lago de montaña con las palabras Primera luz, encuadrada como una historia. A la derecha, controles de estilo, color y tamaño del texto y un botón Publicar historia.',
  caption: 'Suelta una foto. Recórtala. Añade texto.',
  statement: ['Publica', 'la foto.', 'Sin', '<span lang="en">doomscroll</span>.'],
  posting: 'Normalmente de 15 a 25 segundos. Sin tocar nada, con la pestaña al frente.',
  postingAlt:
    'Una historia con un atardecer morado sobre unas colinas, las palabras Hora dorada y una marca de verificación redonda encima.',
  repost: 'Republica una publicación con foto, como imagen.',
  repostAlt:
    'Una historia que muestra una publicación con la foto de un lago de montaña como una tarjeta, con el usuario a.friend.example arriba.',
  installHead: 'Instálala a mano.',
  steps: [
    '<strong>Descomprime.</strong> Mueve la carpeta fuera de Descargas y déjala ahí.',
    '<strong>Copia la dirección para tu navegador.</strong> Pégala en otra pestaña.',
    '<strong>Activa el Modo de desarrollador,</strong> arriba a la derecha.',
    '<strong>Haz clic en Cargar o <span lang="en">Load</span>.</strong> Elige la carpeta instapost.',
    '<strong>Abre o recarga Instagram.</strong> Nueva historia está en la barra lateral izquierda.',
  ],
  wellFolder: 'instapost',
  wellDev: 'Modo de desarrollador',
  wellLoad: 'Cargar extensión sin empaquetar',
  copy: 'Copiar',
  copied: 'Copiado',
  copyFail: 'Selecciona y copia',
  browserChrome: 'Chrome',
  browserArc: 'Arc',
  line: 'Probada en Instagram real solo en Arc en una Mac, con una cuenta secundaria.',
  detailsLink: 'Límites, riesgo, datos, actualizaciones',
  source: 'Código',
  legal: 'No está afiliada a Instagram ni a Meta. © 2026 monsieurBelbo.',
  details: {
    title: 'instapost: límites, riesgo, datos, actualizaciones',
    description: 'Lo que instapost no hace, lo que arriesga, lo que guarda y envía, y cómo actualizarla o quitarla.',
    head: 'Detalles.',
    limits: {
      title: 'Límites',
      items: [
        'Una foto por historia: JPEG, PNG, WebP, AVIF, HEIC (de iPhone sin probar). Sin GIF, TIFF, video, Reels.',
        'Un cuadro de texto. Sin música, menciones, enlaces, encuestas, stickers, Mejores amigos, dibujo, historias programadas.',
        'Primer clic: Hacer la prueba inicial, unos 20 segundos, no publica.',
        'Sin tocar nada, pestaña al frente hasta Compartir; luego, página abierta.',
        'Publicada: Instagram respondió; si no, No se pudo confirmar: revisa tu historia. Sin reintentos.',
        '60 segundos entre historias, 6 por hora, 15 al día; las fallidas cuentan.',
        'Chrome o Arc en computadora, Chromium 155+, sesión iniciada, mismo perfil, no incógnito.',
        '¿Sin Nueva historia? En Instagram: Menú de extensiones, icono de instapost.',
      ],
    },
    reposts: {
      title: 'Republicar',
      items: [
        'Publicaciones con foto: Compartir → Añadir a tu historia. Imagen con @usuario ajeno, sin sticker, enlace ni aviso al autor.',
        'Historias con foto que te mencionan: mensajes directos, hasta 24 horas, Instagram en inglés/español.',
        'Republica solo con permiso.',
      ],
    },
    risk: {
      title: 'Riesgo',
      items: [
        'Funciona fuera de los términos de Instagram: tu cuenta, tu riesgo. Prueba antes con una secundaria.',
        'Instagram puede notarlo: su código ve botón (cada página), marco; servidores, publicaciones inusuales.',
        'Solo durante una publicación o prueba, en esa pestaña: Instagram móvil en marco de teléfono, solicitudes Android, script que dice vertical, toques simulados.',
        '<code>User-Agent</code>, <code>Sec-CH-UA-Mobile</code>, <code>Sec-CH-UA-Platform</code> dicen Android; <code>X-Frame-Options</code>, client hints detalladas, fuera; <code>Sec-Fetch-Dest</code>: <code>document</code>.',
        'Si Instagram cambia y la rompe antes de Compartir, se detiene.',
        'Una verificación de seguridad puede ocupar la pestaña y pausar publicaciones 7 días; instapost te pide completarla en tu teléfono.',
        'Quien pueda cambiar la carpeta puede ejecutar código en tu sesión de Instagram. <a href="../">Descárgala aquí.</a>',
      ],
    },
    tried: {
      title: 'Dónde se usó',
      items: [
        '<b>Instagram real:</b> solo Arc en Mac, cuenta secundaria; republicar, muy poco.',
        '<b>Solo pruebas:</b> Chromium 155, 156.',
        '<b>No en Instagram real:</b> Google Chrome, cuentas principales, de creador o empresa, español, otros idiomas, republicar menciones.',
        '<b>Nunca:</b> Edge, Brave, Windows, Linux.',
      ],
    },
    data: {
      title: 'Tus datos',
      items: [
        'Sin servidor ni analíticas, aquí o en la extensión. Se queda en tu computadora.',
        'Mientras la página siga abierta, lo fallido o sin confirmar va a Descargas/instapost, salvo republicaciones.',
        'Copiar diagnóstico: solo portapapeles; usuario, últimas ejecuciones, páginas, @usuarios republicados. Léelo antes de pegarlo.',
        'Tu historia va a Instagram; al republicar se piden imagen y avatar a su servidor de imágenes, tras preguntarte tu navegador, sin cookies.',
      ],
    },
    permissions: {
      title: 'Permisos',
      items: [
        'Almacenamiento, descargas, scripting, reglas de red, observar solicitudes, en Instagram; opcionales: *.cdninstagram.com, *.fna.fbcdn.net.',
        'Navegador: «Leer y modificar tus datos», «Administrar tus descargas», «Bloquear contenido en cualquier página».',
        'No: pestañas, cookies, depurador, todos los sitios.',
        'Lee tu usuario, publicación compartida, texto de mensajes directos junto a enlaces a historias.',
      ],
    },
    updating: {
      title: 'Actualizar. Quitar.',
      items: [
        'Sin actualizaciones automáticas. Reemplaza el contenido de la carpeta, pulsa ↻ en instapost, recarga Instagram. Ajustes intactos.',
        '¿Arc sigue con la anterior? Quítala y cárgala de nuevo.',
        'Quitar borra ajustes, borradores, fotos recientes, historial; la carpeta y Descargas/instapost, bórralas tú.',
      ],
    },
    versionHead: 'Esta versión',
    newIn: 'Novedades de {v}.',
    allChanges: 'Todos los cambios',
    pictures: {
      title: 'Las imágenes',
      items: ['Las de instapost son reales, en una réplica local de Instagram, cuentas inventadas; resto dibujado.'],
    },
    foot: {
      changelog: 'Cambios',
      older: 'Versiones anteriores',
      problem: 'Informar de un problema',
      licence: 'Licencia MIT',
      font: 'Licencia de la tipografía',
      asIs: 'Se ofrece tal cual. Avisos de terceros en el zip.',
      affiliation: 'No está afiliada a Instagram ni a Meta. «Instagram» es marca de Instagram, LLC.',
      hosting: 'GitHub Pages registra visitas. © 2026 monsieurBelbo.',
    },
  },
  notFound: { head: 'Página no encontrada.', body: 'Esa dirección no existe aquí.', link: 'Ir a instapost' },
};
