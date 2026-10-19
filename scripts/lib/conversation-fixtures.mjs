/**
 * P3-012 conversation-first fixtures (verifier-owned, no product code).
 *
 * Two structurally different genres, each a complete HTML composition document
 * that satisfies the frozen P3-012 composition contract (PROTOCOL.md section 2):
 *
 *   genre A — "Night Line": an inline-SVG illustrated animation (1280x720):
 *             SVG gradients avoided on purpose (no `url(...)` references at all),
 *             so the fixture only exercises inline SVG shapes, the SVG `xmlns`
 *             namespace exception, HTML text and a GSAP timeline.
 *   genre B — "Signal / Drift": kinetic typography (720x1280 vertical), pure
 *             inline HTML/CSS text animation, no SVG, different palette,
 *             different duration and different animation grammar.
 *
 * Nothing here is pelican/ball-specific and nothing fetches: the only referenced
 * asset is `./assets/gsap.min.js`, which the engine's managed project template
 * declares in `project.json`.
 *
 * `checkCompositionContract` is an independent regex/structural check used only
 * to keep the fixtures honest before they are submitted. It is NOT the product
 * validator; the worker import of `composition.mjs` remains the authority.
 */

const GSAP_ASSET = './assets/gsap.min.js';
const DECLARED_ASSETS = Object.freeze([GSAP_ASSET, 'assets/gsap.min.js']);

/** UTF-8 byte length (not character count) of one document. */
export function byteLength(text) {
  return Buffer.byteLength(text, 'utf8');
}

/** Strip optional BOM/leading whitespace for the "starts with doctype/html" rule. */
function leading(text) {
  return text.replace(/^\uFEFF/, '').replace(/^\s+/, '');
}

function attribute(elementText, name) {
  const pattern = new RegExp('\\s' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i');
  const match = pattern.exec(elementText);
  if (match === null) return undefined;
  return match[1] !== undefined ? match[1] : match[2];
}

function countMainElements(html) {
  // Exactly one element carrying id="main" (attribute order tolerant).
  const tags = html.match(/<[a-zA-Z][^>]*>/g) || [];
  let count = 0;
  let elementText = null;
  for (const tag of tags) {
    const id = attribute(tag, 'id');
    if (id === 'main') {
      count += 1;
      elementText = tag;
    }
  }
  return { count, elementText };
}

/**
 * Independent fixture sanity check against the frozen contract. Returns a
 * structured result instead of throwing so the harness can record details.
 */
export function checkCompositionContract(html, label) {
  const problems = [];
  const facts = {
    label: typeof label === 'string' ? label : null,
    bytes: typeof html === 'string' ? byteLength(html) : null,
    width: null,
    height: null,
    duration: null,
    compositionId: null,
    mainCount: null,
    hasTimelines: false,
    forbiddenTags: [],
    urlRefs: [],
  };
  if (typeof html !== 'string' || html.length === 0) {
    problems.push('html must be a non-empty string');
    return { ok: false, problems, facts };
  }
  if (facts.bytes < 1 || facts.bytes > 48 * 1024) problems.push('byte length outside 1..49152: ' + facts.bytes);
  if (html.includes('\0')) problems.push('NUL byte present');
  const start = leading(html);
  if (/^<!doctype html/i.test(start) === false && /^<html[\s>]/i.test(start) === false) {
    problems.push('document does not start with a doctype or <html>');
  }
  if (/<\/html\s*>/i.test(html) === false) problems.push('missing </html>');
  const main = countMainElements(html);
  facts.mainCount = main.count;
  if (main.count !== 1) problems.push('expected exactly one id="main" element, got ' + main.count);
  if (main.elementText !== null) {
    facts.compositionId = attribute(main.elementText, 'data-composition-id') || null;
    facts.width = Number(attribute(main.elementText, 'data-width'));
    facts.height = Number(attribute(main.elementText, 'data-height'));
    facts.duration = Number(attribute(main.elementText, 'data-duration'));
    if (typeof facts.compositionId !== 'string' || facts.compositionId.length === 0) problems.push('#main has no non-empty data-composition-id');
    if (!Number.isFinite(facts.width) || facts.width < 320 || facts.width > 3840) problems.push('data-width outside 320..3840: ' + attribute(main.elementText, 'data-width'));
    if (!Number.isFinite(facts.height) || facts.height < 180 || facts.height > 2160) problems.push('data-height outside 180..2160: ' + attribute(main.elementText, 'data-height'));
    if (!Number.isFinite(facts.duration) || facts.duration < 0.1 || facts.duration > 3600) problems.push('data-duration outside 0.1..3600: ' + attribute(main.elementText, 'data-duration'));
  }
  const timelineMatch = /window\s*(?:\.\s*__timelines|\[\s*['"]__timelines['"]\s*\])\s*=/.exec(html);
  facts.hasTimelines = timelineMatch !== null && /__timelines[\s\S]{0,200}?\bmain\s*:/.test(html);
  if (!facts.hasTimelines) problems.push('does not assign window.__timelines with a main key');
  const forbiddenTagPattern = /<\s*(iframe|object|embed|base|link|video|audio|source|track)\b/gi;
  let tagMatch;
  while ((tagMatch = forbiddenTagPattern.exec(html)) !== null) facts.forbiddenTags.push(tagMatch[1].toLowerCase());
  if (facts.forbiddenTags.length > 0) problems.push('forbidden tags present: ' + facts.forbiddenTags.join(', '));
  const attributePattern = /(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let attrMatch;
  while ((attrMatch = attributePattern.exec(html)) !== null) {
    facts.urlRefs.push({ position: 'attribute', value: attrMatch[1] !== undefined ? attrMatch[1] : attrMatch[2] });
  }
  const cssUrlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  let urlMatch;
  while ((urlMatch = cssUrlPattern.exec(html)) !== null) {
    const value = urlMatch[1] !== undefined ? urlMatch[1] : urlMatch[2] !== undefined ? urlMatch[2] : urlMatch[3];
    facts.urlRefs.push({ position: 'url', value: (value || '').trim() });
  }
  const forbiddenScheme = /^(?:https?:|file:|blob:|javascript:|\/\/)/i;
  for (const ref of facts.urlRefs) {
    if (forbiddenScheme.test(ref.value) && ref.position === 'attribute') problems.push('forbidden URL scheme in src/href: ' + ref.value);
    if (forbiddenScheme.test(ref.value) && ref.position === 'url') problems.push('forbidden URL scheme in url(): ' + ref.value);
    if (ref.value.startsWith('#')) continue;
    if (/^(?:https?:|file:|blob:|javascript:|\/\/|data:)/i.test(ref.value)) {
      if (ref.position === 'attribute' && !forbiddenScheme.test(ref.value)) {
        // data: in src/href is not explicitly listed in the frozen contract; the
        // fixtures avoid it entirely, so flag it as a fixture defect.
        problems.push('unexpected data: reference in fixture: ' + ref.value);
      }
      continue;
    }
    if (DECLARED_ASSETS.includes(ref.value)) continue;
    problems.push('local reference not declared in the fixture manifest: ' + ref.value + ' (' + ref.position + ')');
  }
  if (html.includes('./assets/gsap.min.js') === false) problems.push('fixture does not use ./assets/gsap.min.js');
  return { ok: problems.length === 0, problems, facts };
}

/**
 * Apply exact one-occurrence string replacements to a source document.
 * Used for the round-2 modification of an already published composition so the
 * modification is derived from the real published bytes, not regenerated.
 */
export function replaceOnce(source, replacements, label) {
  let next = source;
  const applied = [];
  for (const [from, to] of replacements) {
    const index = next.indexOf(from);
    if (index === -1) throw new Error((label || 'modification') + ': marker not found: ' + JSON.stringify(from.slice(0, 80)));
    if (next.indexOf(from, index + 1) !== -1) throw new Error((label || 'modification') + ': marker is not unique: ' + JSON.stringify(from.slice(0, 80)));
    next = next.slice(0, index) + to + next.slice(index + from.length);
    applied.push({ from: from.slice(0, 80), to: to.slice(0, 80) });
  }
  return { html: next, applied };
}

// ─── genre A: inline-SVG illustrated animation (1280x720, 6s) ──────────────

const GENRE_A_META = Object.freeze({ width: 1280, height: 720, duration: 6, compositionId: 'fixture-genre-a' });

function genreAStars() {
  const stars = [
    [90, 70, 2.2], [180, 120, 1.6], [265, 60, 2.6], [350, 150, 1.4], [430, 80, 2.0],
    [520, 130, 1.8], [610, 55, 2.4], [700, 165, 1.5], [780, 95, 2.1], [860, 135, 1.7],
    [940, 65, 2.5], [1010, 150, 1.6], [1100, 90, 2.2], [1180, 130, 1.8], [1250, 70, 2.0],
    [150, 220, 1.5], [320, 250, 1.7], [480, 210, 1.4], [650, 260, 1.9], [820, 225, 1.5],
    [990, 255, 1.6], [1150, 215, 1.8], [60, 300, 1.4], [400, 320, 1.3], [760, 305, 1.5],
  ];
  return stars.map(([cx, cy, r]) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#e8eefc"/>').join('');
}

function genreAHills() {
  return [
    '<path id="gA-ridge-far" d="M0 470 L150 360 L280 440 L430 330 L560 430 L700 350 L860 440 L1010 365 L1140 445 L1280 380 L1280 720 L0 720 Z" fill="#16233c"/>',
    '<path id="gA-ridge-near" d="M0 540 L120 465 L260 530 L410 445 L560 535 L720 470 L880 545 L1030 480 L1180 550 L1280 500 L1280 720 L0 720 Z" fill="#0e1728"/>',
  ].join('\n    ');
}

function genreATrain() {
  const windows = [0, 1, 2, 3, 4].map((index) => {
    const x = 42 + index * 34;
    return '<rect x="' + x + '" y="596" width="20" height="16" rx="3" fill="#ffd479"/>';
  }).join('');
  return [
    '<g id="gA-train">',
    '      <rect x="0" y="580" width="214" height="56" rx="12" fill="#2c3b58"/>',
    '      <rect x="8" y="588" width="46" height="24" rx="6" fill="#1a2540"/>',
    '      <rect x="176" y="588" width="30" height="20" rx="5" fill="#ff8b4d"/>',
    '      ' + windows,
    '      <circle cx="40" cy="642" r="11" fill="#0a1120" stroke="#41557a" stroke-width="3"/>',
    '      <circle cx="84" cy="642" r="11" fill="#0a1120" stroke="#41557a" stroke-width="3"/>',
    '      <circle cx="186" cy="642" r="11" fill="#0a1120" stroke="#41557a" stroke-width="3"/>',
    '    </g>',
  ].join('\n    ');
}

/** Genre A: complete inline-SVG illustrated composition + GSAP timeline. */
export function genreA() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Night Line — illustrated motion study</title>
<style>
html,body{margin:0;overflow:hidden;background:#070d18}
#main{position:relative;width:1280px;height:720px;overflow:hidden;background:#070d18;font-family:Georgia,'Times New Roman',serif;color:#eef3ff}
#gA-title{position:absolute;left:88px;top:470px;margin:0;font-size:88px;letter-spacing:14px;font-weight:400;color:#f6efe0}
#gA-sub{position:absolute;left:96px;top:586px;margin:0;font-size:26px;letter-spacing:3px;color:#9db4d8}
#gA-caption{position:absolute;right:88px;bottom:48px;margin:0;font-size:18px;letter-spacing:6px;color:#6f86ad}
</style>
<script src="./assets/gsap.min.js"></script>
</head>
<body>
<div id="main" data-composition-id="fixture-genre-a" data-width="1280" data-height="720" data-fps="30" data-start="0" data-duration="6">
  <svg id="gA-sky" width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="1280" height="720" fill="#070d18"/>
    <rect width="1280" height="360" fill="#0d1a33" opacity="0.85"/>
    <g id="gA-stars">
    ${genreAStars()}
    </g>
    <circle id="gA-moon" cx="1010" cy="140" r="56" fill="#f4e8c8"/>
    <circle cx="1036" cy="122" r="50" fill="#0d1a33" opacity="0.55"/>
    ${genreAHills()}
    <path id="gA-track" d="M-40 646 H1320" stroke="#33456b" stroke-width="5" fill="none"/>
    <path id="gA-track-2" d="M-40 668 H1320" stroke="#22314f" stroke-width="3" fill="none"/>
    ${genreATrain()}
  </svg>
  <h1 id="gA-title">NIGHT LINE</h1>
  <p id="gA-sub">an illustrated journey after dark</p>
  <p id="gA-caption">INLINE SVG / GSAP</p>
  <script>
    var tl = gsap.timeline({ paused: true });
    tl.fromTo('#gA-title', { opacity: 0, y: 34 }, { opacity: 1, y: 0, duration: 1.2, ease: 'power2.out' }, 0.25);
    tl.fromTo('#gA-sub', { opacity: 0 }, { opacity: 1, duration: 1.1, ease: 'none' }, 0.95);
    tl.fromTo('#gA-caption', { opacity: 0 }, { opacity: 0.9, duration: 0.9, ease: 'none' }, 1.4);
    tl.fromTo('#gA-moon', { y: 70 }, { y: 0, duration: 3.4, ease: 'sine.out' }, 0);
    tl.fromTo('#gA-train', { x: -420 }, { x: 1560, duration: 5.6, ease: 'none' }, 0.2);
    tl.fromTo('#gA-stars', { opacity: 0.35 }, { opacity: 1, duration: 2.2, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0);
    window.__timelines = { main: tl };
    tl.seek(0);
  </script>
</div>
</body>
</html>
`;
  return { html, meta: { ...GENRE_A_META, label: 'genre-a-inline-svg' } };
}

/** Genre A modified (round-3/4 revision in the browser flow): changed content,
 * preserved structure, different accent and animation timing. */
export function genreAModified() {
  const base = genreA().html;
  const { html } = replaceOnce(base, [
    ['<h1 id="gA-title">NIGHT LINE</h1>', '<h1 id="gA-title">NIGHT LINE II</h1>'],
    ['<p id="gA-sub">an illustrated journey after dark</p>', '<p id="gA-sub">a second illustrated passage</p>'],
    ['fill="#f4e8c8"', 'fill="#ffd9a0"'],
    ['duration: 1.2, ease: \'power2.out\'', 'duration: 0.8, ease: \'power3.out\''],
  ], 'genre A modification');
  return { html, meta: { ...GENRE_A_META, label: 'genre-a-inline-svg-modified',
    width: GENRE_A_META.width, height: GENRE_A_META.height, duration: GENRE_A_META.duration } };
}

// ─── genre B: kinetic typography (720x1280 vertical, 5s) ───────────────────

const GENRE_B_META = Object.freeze({ width: 720, height: 1280, duration: 5, compositionId: 'fixture-genre-b' });
const GENRE_B_ACCENT = '#ff5c00';

export function genreB() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signal Drift — kinetic typography</title>
<style>
html,body{margin:0;overflow:hidden;background:#f4efe6}
#main{position:relative;width:720px;height:1280px;overflow:hidden;background:#f4efe6;color:#12100e;font-family:Helvetica,Arial,sans-serif;--gB-accent:${GENRE_B_ACCENT}}
#gB-bg{position:absolute;left:0;top:0;width:720px;height:1280px;background:#f4efe6}
#gB-kicker{position:absolute;left:56px;top:96px;margin:0;font-size:22px;letter-spacing:9px;font-weight:700;color:#12100e}
#gB-word-1{position:absolute;left:48px;top:380px;display:block;font-size:150px;font-weight:800;letter-spacing:-4px;line-height:0.95;color:#12100e}
#gB-word-2{position:absolute;left:48px;top:530px;display:block;font-size:150px;font-weight:800;letter-spacing:-4px;line-height:0.95;color:var(--gB-accent)}
#gB-rule{position:absolute;left:56px;top:760px;width:600px;height:14px;background:var(--gB-accent)}
#gB-sub{position:absolute;left:56px;top:812px;margin:0;font-size:30px;letter-spacing:2px;color:#3d3833}
#gB-foot{position:absolute;left:56px;bottom:64px;margin:0;font-size:20px;letter-spacing:7px;color:#87796a}
#gB-block{position:absolute;right:56px;top:210px;width:120px;height:120px;background:#12100e}
</style>
<script src="./assets/gsap.min.js"></script>
</head>
<body>
<div id="main" data-composition-id="fixture-genre-b" data-width="720" data-height="1280" data-fps="30" data-start="0" data-duration="5">
  <div id="gB-bg"></div>
  <p id="gB-kicker">KINETIC TYPOGRAPHY STUDY</p>
  <span id="gB-word-1">SIGNAL</span>
  <span id="gB-word-2">DRIFT</span>
  <div id="gB-rule"></div>
  <p id="gB-sub">words measured in motion</p>
  <p id="gB-foot">KINETIC / SERIES 02</p>
  <div id="gB-block"></div>
  <script>
    var tl = gsap.timeline({ paused: true });
    tl.fromTo('#gB-kicker', { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.7, ease: 'power2.out' }, 0.1);
    tl.fromTo('#gB-word-1', { opacity: 0, scale: 0.86, y: 60 }, { opacity: 1, scale: 1, y: 0, duration: 1.35, ease: 'power3.out' }, 0.35);
    tl.fromTo('#gB-word-2', { opacity: 0, x: 180 }, { opacity: 1, x: 0, duration: 1.35, ease: 'power3.out' }, 0.7);
    tl.fromTo('#gB-rule', { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'none', transformOrigin: 'left center' }, 1.2);
    tl.fromTo('#gB-sub', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power1.out' }, 1.8);
    tl.fromTo('#gB-foot', { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'none' }, 2.2);
    tl.fromTo('#gB-block', { scale: 0, rotation: -30 }, { scale: 1, rotation: 0, duration: 0.9, ease: 'back.out(1.6)' }, 0.5);
    window.__timelines = { main: tl };
    tl.seek(0);
  </script>
</div>
</body>
</html>
`;
  return { html, meta: { ...GENRE_B_META, label: 'genre-b-kinetic-typography' } };
}

/** Round-2 modification of an already published genre B document: change the
 * second headline word, the accent colour and one animation; preserve the rest. */
export function modifyGenreB(source) {
  const { html, applied } = replaceOnce(source, [
    ['<span id="gB-word-2">DRIFT</span>', '<span id="gB-word-2">TIDE</span>'],
    ['--gB-accent:#ff5c00', '--gB-accent:#7cf6c0'],
    ['duration: 1.35, ease: \'power3.out\' }, 0.35', 'duration: 0.85, ease: \'back.out(1.7)\' }, 0.35'],
  ], 'genre B round-2 modification');
  return { html, applied };
}

/** Round-3 modification derived from a modified genre B document (idempotency
 * and "unchanged" probes use this distinct third body). */
export function modifyGenreBAgain(source) {
  const { html, applied } = replaceOnce(source, [
    ['<span id="gB-word-2">TIDE</span>', '<span id="gB-word-2">CURRENT</span>'],
    ['--gB-accent:#7cf6c0', '--gB-accent:#8ecbff'],
    ['<p id="gB-foot">KINETIC / SERIES 02</p>', '<p id="gB-foot">KINETIC / SERIES 03</p>'],
  ], 'genre B round-3 modification');
  return { html, applied };
}

// ─── failure-case fixtures (derived from a valid genre B document) ─────────

function insertBeforeBodyEnd(source, fragment) {
  const index = source.lastIndexOf('</body>');
  if (index === -1) throw new Error('fixture has no </body>');
  return source.slice(0, index) + fragment + '\n' + source.slice(index);
}

function replaceRequired(source, from, to, label) {
  if (source.includes(from) === false) throw new Error('fixture marker missing for ' + label);
  return source.split(from).join(to);
}

/**
 * Build the failure-case fixture table from a valid source document.
 *
 * `layer` names which boundary must reject it: 'host' (validateParams before the
 * worker) or 'worker' (composition.mjs validation, surfaced as E_COMPOSE_INVALID).
 * Every entry is expected to leave the project revision and entry bytes unchanged.
 */
export function failureFixtures(validSource) {
  const html = (label) => '<!doctype html><html><body><div id="main" data-composition-id="' + label + '" data-width="720" data-height="1280" data-duration="5"><script>window.__timelines = { main: { seek: function(){}, play: function(){}, pause: function(){} } };</script></div></body></html>';
  const oversize = validSource.slice(0, validSource.lastIndexOf('</body>')) + '<!--' + 'x'.repeat(49 * 1024) + '-->\n</body>\n</html>';
  const list = [
    {
      id: 'no-main',
      description: '#main element missing',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: html('no-main').replace('id="main"', 'id="stage"'),
    },
    {
      id: 'missing-timelines',
      description: 'window.__timelines assignment removed',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: replaceRequired(validSource, '    window.__timelines = { main: tl };\n', '', 'missing-timelines'),
    },
    {
      id: 'external-https-image',
      description: 'https: image reference',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<img src="https://example.com/pixel.png" alt="">'),
    },
    {
      id: 'external-protocol-relative',
      description: 'protocol-relative image reference',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<img src="//cdn.example.com/a.png" alt="">'),
    },
    {
      id: 'external-file-url',
      description: 'file: image reference',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<img src="file:///tmp/a.png" alt="">'),
    },
    {
      id: 'external-javascript-url',
      description: 'javascript: link reference',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<a href="javascript:alert(1)">x</a>'),
    },
    {
      id: 'external-blob-url',
      description: 'blob: image reference',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<img src="blob:https://example.com/abc" alt="">'),
    },
    {
      id: 'forbidden-iframe',
      description: '<iframe> surface',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<iframe src="./index.html"></iframe>'),
    },
    {
      id: 'forbidden-video',
      description: '<video> surface',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<video controls></video>'),
    },
    {
      id: 'forbidden-audio',
      description: '<audio> surface',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<audio controls></audio>'),
    },
    {
      id: 'forbidden-link',
      description: '<link> surface',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<link rel="stylesheet" href="./assets/gsap.min.js">'),
    },
    {
      id: 'forbidden-source-track',
      description: '<source>/<track> surfaces',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<source src="./assets/gsap.min.js"><track src="./assets/gsap.min.js">'),
    },
    {
      id: 'external-script',
      description: 'external script URL',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>'),
    },
    {
      id: 'undeclared-asset-script',
      description: 'script references an asset not in project.json',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<script src="./assets/extra.js"></script>'),
    },
    {
      id: 'undeclared-asset-image',
      description: 'image references an asset not in project.json',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<img src="./assets/photo.png" alt="">'),
    },
    {
      id: 'absolute-asset-path',
      description: 'absolute asset path',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<img src="/assets/gsap.min.js" alt="">'),
    },
    {
      id: 'parent-traversal-asset',
      description: 'parent traversal asset path',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<img src="../outside.png" alt="">'),
    },
    {
      id: 'duplicate-main',
      description: 'two #main elements',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: insertBeforeBodyEnd(validSource, '<div id="main" data-composition-id="second"><script>window.__timelines = { main: null };</script></div>'),
    },
    {
      id: 'bad-duration-range',
      description: 'data-duration below 0.1',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: replaceRequired(validSource, 'data-duration="5"', 'data-duration="0"', 'bad-duration'),
    },
    {
      id: 'bad-width-range',
      description: 'data-width below 320',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: replaceRequired(validSource, 'data-width="720"', 'data-width="100"', 'bad-width'),
    },
    {
      id: 'non-numeric-height',
      description: 'data-height not numeric',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: replaceRequired(validSource, 'data-height="1280"', 'data-height="tall"', 'bad-height'),
    },
    {
      id: 'missing-composition-id',
      description: 'data-composition-id missing',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: replaceRequired(validSource, ' data-composition-id="fixture-genre-b"', '', 'missing-composition-id'),
    },
    {
      id: 'fragment-not-document',
      description: 'HTML fragment with no doctype/document',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: '<div id="main" data-composition-id="fragment" data-width="720" data-height="1280" data-duration="5">fragment</div>',
    },
    {
      id: 'garbage-before-doctype',
      description: 'document does not start with doctype/html',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: '<div>garbage</div>' + validSource,
    },
    {
      id: 'missing-html-close',
      description: 'missing </html>',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: replaceRequired(validSource, '</html>', '', 'missing-html-close'),
    },
    {
      id: 'nul-byte',
      description: 'NUL byte in the document',
      layer: 'host',
      expectedCode: 'E_PARAMS',
      html: validSource.replace('</body>', '\0</body>'),
    },
    {
      id: 'oversize-49kib',
      description: 'document larger than 48 KiB',
      layer: 'host',
      expectedCode: 'E_PARAMS',
      html: oversize,
    },
    {
      id: 'empty-html',
      description: 'empty html string',
      layer: 'host',
      expectedCode: 'E_PARAMS',
      html: '',
    },
    {
      id: 'whitespace-only-html',
      description: 'whitespace-only html string',
      layer: 'worker',
      expectedCode: 'E_COMPOSE_INVALID',
      html: '   ',
    },
  ];
  // Every fixture must be independently complete except the deliberately broken
  // ones; the harness records the contract self-check result for each.
  return list;
}

/** Exploratory ambiguity probe: a legitimate SVG `url(#fragment)` paint server.
 * The frozen contract rejects external URL schemes in url() but says nothing
 * about same-document fragment references; the harness records the product
 * behaviour instead of asserting a direction. */
export function svgFragmentUrlProbe(baseSource) {
  return insertBeforeBodyEnd(
    baseSource,
    '<svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="probe-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#7cf6c0"/></linearGradient></defs><rect width="80" height="80" fill="url(#probe-grad)"/></svg>'
  );
}

export const FIXTURE_DECLARED_ASSETS = DECLARED_ASSETS;
export const GENRE_META = Object.freeze({ a: GENRE_A_META, b: GENRE_B_META });
