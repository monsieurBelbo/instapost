/**
 * The page's Spanish words: neutral Spanish (tú, no vos, no region-only words), the product's own terms from
 * src/ui/catalog.es.ts and catalog.page.es.ts (Nueva historia, Publicar historia, Hacer la prueba inicial, Compartir,
 * Añadir a tu historia, Ajustes, borrador, Fotos recientes, No se pudo confirmar, equipo, stickers, video).
 * Chrome's own labels were read from Chromium's translations: es "Cargar descomprimida", es-419 "Cargar extensión sin
 * empaquetar", "Modo de desarrollador", "Quitar", "Volver a cargar", "Leer y modificar tus datos".
 */
import type { Copy } from './copy.en.ts';

export const ES: Copy = {
  lang: 'es',
  locale: 'es_LA',
  otherLang: { label: 'English', hreflang: 'en' },
  title: 'instapost: publica historias de Instagram desde el escritorio',
  description:
    'Una extensión de navegador gratis para Chrome y Arc. Añade un botón Nueva historia a Instagram en la web. Solo fotos, se instala a mano y se usa bajo tu propio riesgo. Sin afiliación con Instagram.',
  ogAlt: 'instapost: publica historias de Instagram desde el escritorio.',
  months: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  h1: ['Publica', 'historias', 'de Instagram', 'desde el', 'escritorio.'],
  sub: 'Una extensión de navegador gratis para Chrome y Arc.',
  download: 'Descargar instapost {v}',
  noRelease: 'Todavía no hay descarga. La primera versión está en camino.',
  phone: 'Funciona en un navegador de escritorio. Abre esta página ahí.',
  risk: 'Queda fuera de los términos de uso de Instagram, así que usas tu cuenta bajo tu propio riesgo. Prueba primero con una cuenta secundaria.',
  metaRelease: 'Zip, {size}. Publicada el {date}.',
  prerelease: 'Esta es una vista previa de la próxima versión.',
  whatsNewLink: 'Novedades',
  needs: 'Necesita Chrome 155 o posterior, o Arc con Chromium 155 o posterior, en versión de escritorio.',
  tried:
    'Solo se probó en Instagram real con Arc en macOS y con una cuenta secundaria. Windows y Linux están sin probar.',
  sourceLink: 'Código en GitHub',
  lead: 'instapost añade un botón Nueva historia a Instagram en la web. Elige una foto, añade texto si quieres y pulsa Publicar historia. Solo fotos: sin video, música ni menciones.',
  why: 'La hice para compartir una foto sin abrir la app y sin perderme en el feed.',
  entry: 'Nueva historia',
  entryNote: 'instapost añade esto',
  caption:
    'Una ilustración. La ventana de instapost es real, capturada en una réplica local de Instagram con una cuenta inventada. Todo lo que la rodea está dibujado.',
  shotAlt:
    'La ventana de instapost. A la izquierda, la foto de un lago de montaña con las palabras Primera luz, encuadrada como una historia. A la derecha, controles de estilo, color y tamaño del texto y un botón Publicar historia.',
  installHead: 'Instálala',
  installIntro: 'instapost no está en Chrome Web Store, así que la cargas a mano.',
  wellFolder: 'instapost',
  wellChoose: 'elige esta',
  wellDev: 'Modo de desarrollador',
  wellLoad: 'Cargar descomprimida',
  copy: 'Copiar',
  copied: 'Copiado',
  copyFail: 'Selecciona y copia',
  browserChrome: 'Chrome',
  browserArc: 'Arc',
  steps: [
    {
      title: 'Descomprime el zip.',
      body: 'Haz doble clic en el zip que descargaste. Deja la carpeta instapost en un lugar fijo, fuera de Descargas. El navegador la lee ahí cada vez, así que no la muevas ni la borres. Si la mueves, repite el paso 4.',
    },
    {
      title: 'Abre la página de extensiones.',
      body: 'Copia la dirección de tu navegador y pégala en una pestaña nueva.',
    },
    {
      title: 'Activa el Modo de desarrollador.',
      body: 'El interruptor está arriba a la derecha de esa página. Es lo que permite añadir una extensión a mano. Déjalo activado.',
    },
    {
      title: 'Haz clic en Cargar descomprimida.',
      body: 'Según el idioma del navegador, puede decir Cargar extensión sin empaquetar o <span lang="en">Load unpacked</span>. Elige la carpeta instapost, la que contiene directamente <code>manifest.json</code>.',
    },
    {
      title: 'Haz clic en Nueva historia.',
      body: 'Abre o recarga instagram.com en una ventana normal, no de incógnito, con la sesión iniciada en una cuenta secundaria, si tienes una. Nueva historia está en la barra lateral izquierda de Instagram. ¿No está? En Instagram, haz clic en el icono de instapost en el menú de extensiones. Añade una foto, pulsa Hacer la prueba inicial y quédate en esa pestaña. Tarda unos 20 segundos y no publica nada. Después, al pulsar Publicar historia se publica de verdad.',
    },
  ],
  newIn: 'Novedades de {v}.',
  allChanges: 'Todos los cambios',
  updating: {
    title: 'Actualizar.',
    body: 'Nada se actualiza solo, así que vuelve aquí a buscar versiones nuevas. Reemplaza el contenido de la carpeta por la versión nueva. En la página de extensiones, haz clic en Volver a cargar (↻) en instapost y recarga Instagram. Tus ajustes se conservan. Si Arc se queda con la versión anterior, usa Quitar y vuelve a cargarla, pero eso borra lo que instapost guardó en tu navegador.',
  },
  removing: {
    title: 'Quitar.',
    body: 'En la página de extensiones, haz clic en Quitar. Eso borra tus ajustes, borradores, fotos recientes e historial. Luego borra la carpeta, y también Descargas/instapost si la tienes.',
  },
  ledgerLead: 'Una foto a la vez, con tu clic.',
  canHead: 'Puede',
  cantHead: 'No puede',
  rows: [
    {
      topic: 'Fotos',
      can: [
        '<strong>Abrir tu foto.</strong> Suelta, pega o elige un JPEG, PNG, WebP, AVIF o HEIC. Aún falta probar una foto HEIC real de iPhone.',
      ],
      cant: ['<strong>Sin video ni Reels.</strong> Una foto por historia. GIF y TIFF no se abren.'],
    },
    {
      topic: 'Edición',
      can: [
        '<strong>Encuadrarla y añadir texto.</strong> Arrastra, haz zoom, gira y añade un cuadro de texto. Tu borrador se guarda solo. La imagen final es de 1080 × 1920, sin los datos de ubicación ni de cámara de la foto.',
      ],
      cant: [
        '<strong>Sin música, menciones, enlaces ni encuestas.</strong> Tampoco ubicación, stickers de hashtag ni Mejores amigos. Por lo que encontré, Instagram en la web no los ofrece.',
        '<strong>Sin dibujos ni stickers de Instagram.</strong>',
      ],
    },
    {
      topic: 'Publicar',
      can: [
        '<strong>Publicar por ti.</strong> El sitio móvil de Instagram se abre en un marco del tamaño de un teléfono en tu pestaña e instapost toca +, Historia y Compartir. Suele tardar entre 15 y 25 segundos.',
        '<strong>Decirte qué pasó.</strong> Dice Publicada solo cuando Instagram responde que la historia se publicó. Si no puede saberlo, dice No se pudo confirmar, y tú revisas tu historia.',
      ],
      cant: [
        '<strong>Sin programar publicaciones.</strong>',
        '<strong>Sin publicar en segundo plano.</strong> Mantén la pestaña delante y no toques Instagram hasta Compartir. Hasta entonces puedes detener la publicación. Después de Compartir puedes seguir navegando, pero deja la página abierta. Si la recargas o la cierras, instapost no puede saber si la historia se publicó y dice No se pudo confirmar.',
      ],
    },
    {
      topic: 'Añadir a tu historia',
      can: [
        '<strong>Añadir una publicación con foto, como imagen.</strong> Pulsa el botón Compartir de Instagram y luego Añadir a tu historia. La publicación de otra persona siempre muestra su @usuario. Se ha probado muy poco en Instagram real.',
        '<strong>Añadir una historia que te menciona.</strong> Desde su vista previa en tus mensajes directos. Fotos de menos de 24 horas, con Instagram en inglés o español. Aún sin probar en Instagram real.',
      ],
      cant: [
        '<strong>Sin republicación real.</strong> Es una imagen sin sticker. No se puede tocar para ir al original y el autor no recibe aviso.',
        '<strong>Sin videos ni Reels.</strong> Tampoco publicaciones que se sabe que no permiten compartir.',
      ],
    },
    {
      topic: 'Ritmo',
      can: [
        '<strong>Dejar una historia en cola.</strong> Si pulsas Publicar historia durante el minuto de espera entre historias, esa foto empieza sola cuando acaba la espera. Puedes cancelar.',
      ],
      cant: [
        '<strong>Sin acelerar.</strong> Un minuto entre historias, 6 por hora, 15 al día. Cuenta cada historia iniciada, incluso si falla.',
        '<strong>Sin reintentos.</strong> instapost pulsa Compartir una sola vez por historia. Volver a intentar depende de ti.',
      ],
    },
    {
      topic: 'Dónde',
      can: [
        '<strong>Funcionar en Chrome 155 o posterior, o Arc con Chromium 155 o posterior,</strong> con tu sesión de instagram.com iniciada en el mismo perfil del navegador. Solo Arc, con una cuenta secundaria, se probó en Instagram real.',
      ],
      cant: ['<strong>Sin teléfonos, Firefox ni Safari.</strong>', '<strong>Sin actualizaciones automáticas.</strong>'],
    },
  ],
  riskHead: 'Usas tu cuenta bajo tu propio riesgo.',
  riskLead:
    'Usar instapost queda fuera de los términos de uso de Instagram. Pruébala primero con una cuenta secundaria.',
  riskBlocks: [
    {
      title: 'Dónde se ha usado.',
      body: '<b>En Instagram real:</b> solo Arc (Chromium 155) en macOS, con una cuenta personal secundaria. Añadir a tu historia una publicación con foto se ha probado muy poco.<br><b>Solo pruebas automáticas,</b> contra una réplica local de Instagram: Chromium 155 y 156.<br><b>Aún sin probar en Instagram real:</b> Google Chrome, cuentas principales, cuentas de creador y de empresa, fotos HEIC reales de iPhone, Instagram en español o en cualquier otro idioma que no sea inglés, añadir historias que te mencionan.<br><b>Sin probar en absoluto:</b> Edge, Brave, Windows, Linux.',
    },
    {
      title: 'Instagram puede notarlo.',
      body: 'El código de su página puede ver el botón de instapost en cada página y el marco de teléfono durante una publicación o prueba. Una publicación hecha así también se ve inusual para sus servidores.',
    },
    {
      title: 'Durante una publicación o prueba.',
      body: 'Solo en la pestaña donde ocurre, las solicitudes de Instagram dicen venir de un teléfono Android, incluidas las que tu página de escritorio hace en segundo plano. Cambian algunos encabezados para que el sitio móvil cargue en el marco, un pequeño script le dice que la pantalla es vertical y los toques son simulados. Todo termina con la publicación o la prueba.',
    },
    {
      title: 'Puede romperse.',
      body: 'En cualquier momento, si Instagram cambia su página. Si hay una publicación en curso, instapost se detiene, te dice por qué y no pulsa Compartir. Si Instagram pide una verificación de seguridad, puede ocupar tu pestaña, y entonces instapost pausa la publicación desde el escritorio durante 7 días.',
    },
    {
      title: 'Tu carpeta.',
      body: 'Quien pueda cambiar los archivos de la carpeta instapost puede ejecutar código dentro de tu Instagram con la sesión iniciada. Descárgala de esta página y guárdala donde solo tú puedas modificarla.',
    },
    {
      title: 'Lo que añades es trabajo de otra gente.',
      body: 'Añade solo lo que tengas permiso para compartir. instapost no siempre puede ver los ajustes del autor.',
    },
  ],
  exactHead: 'Los cambios exactos durante una publicación o prueba',
  exactBody:
    'Se quita <code>X-Frame-Options</code> del marco. <code>Sec-Fetch-Dest</code> pasa a <code>document</code>. Un pequeño script en el propio entorno de JavaScript de Instagram hace que la pantalla se lea como vertical. <code>User-Agent</code> pasa a ser el de un teléfono Android, <code>Sec-CH-UA-Mobile</code> y <code>Sec-CH-UA-Platform</code> dicen lo mismo y se quitan las client hints más detalladas. Durante una prueba también se bloquean las solicitudes de subida y publicación.',
  dataHead: 'Tus datos',
  dataLead: 'instapost no tiene servidor y no me envía nada. No hay analíticas ni en la extensión ni en esta página.',
  dataBlocks: [
    {
      title: 'Qué se queda.',
      body: 'Ajustes, borradores, fotos e historial viven en tu equipo. Mientras la página siga abierta, una historia que falla o no se puede confirmar también se guarda en Descargas/instapost, salvo si viene de Añadir a tu historia. Copiar diagnóstico solo lo pone en tu portapapeles. Lista tus últimas publicaciones y pruebas con su hora y su página, tu nombre de usuario y el @usuario de quien añadiste a tu historia, así que léelo antes de pegarlo en algún sitio.',
    },
    {
      title: 'Qué sale de tu equipo.',
      body: 'Tu historia va a Instagram cuando publicas. Para añadir a tu historia, instapost también pide la imagen al servidor de imágenes de Instagram, que opera Meta, después de que tu navegador te pregunte una vez. En una publicación con foto, también le pide el avatar del autor. Estas solicitudes no envían cookies. Ese servidor las ve y podría saber que vienen de instapost.',
    },
    {
      title: 'Qué pide.',
      body: 'Almacenamiento, descargas, scripting y reglas de red, en www.instagram.com e i.instagram.com. Tu navegador puede describirlos con algo como «Leer y modificar tus datos» y «Bloquear contenido en cualquier página». No pide pestañas, cookies, depurador ni acceso a todos los sitios.',
    },
  ],
  checkTitle: 'Qué puedes comprobar.',
  checkWithRelease:
    'El código es público. El SHA-256 de este zip es <code class="sha">{sha}</code>. En macOS, <code>shasum -a 256</code> seguido del archivo debe mostrar lo mismo.',
  checkWithoutRelease: 'El código es público.',
  permsHead: 'Cada permiso, en palabras simples',
  perms: [
    ['storage, unlimitedStorage', 'Ajustes, borradores, fotos e historial en tu equipo.'],
    [
      'scripting',
      'Pone el código auxiliar de instapost y el script de pantalla vertical en el marco de teléfono, y añade Nueva historia a las pestañas de Instagram ya abiertas.',
    ],
    [
      'downloads',
      'Guardar copia, y copias de las historias que no se publicaron. Tu navegador puede describirlo con algo como «Administrar tus descargas».',
    ],
    [
      'declarativeNetRequest, declarativeNetRequestWithHostAccess',
      'Cambia encabezados durante una publicación o prueba, y bloquea la publicación durante las pruebas.',
    ],
    ['webRequest', 'Observa la carga del marco. Solo observa.'],
    [
      'www.instagram.com, i.instagram.com',
      'Donde funciona. En cada página de Instagram puede leer y cambiar lo que hay. Lee tu nombre de usuario, la publicación en la que pulsas Compartir y, en tus mensajes directos, el texto junto a un enlace a una historia, para detectar una mención. Nada de esto me llega. Las fotos se suben a i.instagram.com.',
    ],
    [
      '*.cdninstagram.com, *.fna.fbcdn.net',
      'Los servidores de imágenes de Instagram. Opcional. Tu navegador te pregunta la primera vez que usas Añadir a tu historia. Solo se usan para eso.',
    ],
  ],
  foot: {
    source: 'Código',
    changelog: 'Cambios',
    older: 'Versiones anteriores',
    problem: 'Informar de un problema',
    licence: 'Licencia MIT',
    font: 'Licencia de la fuente',
    asIs: '© 2026 monsieurBelbo. Se ofrece tal cual, sin garantía. Los avisos de terceros están en el zip, en su carpeta <code>licenses</code>.',
    affiliation:
      'Sin afiliación, respaldo ni patrocinio de Instagram o Meta. «Instagram» es una marca registrada de Instagram, LLC, usada aquí solo para decir con qué funciona la extensión.',
    hosting: 'Esta página está en GitHub Pages, que guarda sus propios registros de visitas.',
  },
  notFound: { head: 'Página no encontrada.', body: 'Esa dirección no existe aquí.', link: 'Ir a instapost' },
};
