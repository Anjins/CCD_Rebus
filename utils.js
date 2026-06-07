function srand(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function hexToRgb(hex) {
  if (!hex || hex[0] !== '#') return [0, 0, 0];
  return [
    parseInt(hex.slice(1, 3), 16) || 0,
    parseInt(hex.slice(3, 5), 16) || 0,
    parseInt(hex.slice(5, 7), 16) || 0,
  ];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toH = x => Math.min(255, Math.round(x * 255)).toString(16).padStart(2, '0');
  return `#${toH(r)}${toH(g)}${toH(b)}`;
}

function emoKey(k) {
  return k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const PLUTCHIK_PT = [
  'alegria', 'tristeza', 'confiança', 'nojo',
  'medo', 'raiva', 'surpresa', 'antecipação',
];

const EMO_COLORS = {
  alegria:     [255, 180,  15],
  tristeza:    [ 45, 110, 220],
  confianca:   [ 30, 190, 100],
  nojo:        [135, 195,  40],
  medo:        [130,  40, 190],
  raiva:       [235,  35,  35],
  surpresa:    [255, 105,  20],
  antecipacao: [ 15, 210, 200],
};

const EMO_SHAPES = {
  alegria:     ['oval',     'dot',      'oval'],
  tristeza:    ['line',     'rect',     'line'],
  confianca:   ['rect',     'oval',     'dot'],
  nojo:        ['line',     'rect',     'dot'],
  medo:        ['triangle', 'line',     'triangle'],
  raiva:       ['triangle', 'rect',     'line'],
  surpresa:    ['dot',      'oval',     'triangle'],
  antecipacao: ['line',     'triangle', 'oval'],
};

function getDominantEmo(avg) {
  if (!avg) return 'neutro';
  let best = null, bestVal = 0;
  for (const [k, v] of Object.entries(avg)) {
    if (v > bestVal) { bestVal = v; best = emoKey(k); }
  }
  return best || 'neutro';
}

function blendEmotionColor(avg) {
  let r = 0, g = 0, b = 0, total = 0;
  for (const [normKey, col] of Object.entries(EMO_COLORS)) {
    const ptKey = PLUTCHIK_PT.find(p => emoKey(p) === normKey) || normKey;
    const w = avg[ptKey] || 0;
    r += col[0] * w; g += col[1] * w; b += col[2] * w; total += w;
  }
  if (total === 0) return '#3a3228';
  const hex = (() => {
    const h = v => Math.round(Math.min(255, v / total)).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  })();
  const [hh, ss, ll] = rgbToHsl(...hexToRgb(hex));
  return hslToHex(hh, Math.min(70, ss * 1.2 + 10), Math.max(22, Math.min(52, ll * 0.88)));
}

function pickShapeType(normEmo, charCode, seed) {
  const opts = (normEmo && EMO_SHAPES[normEmo]) || ['oval', 'rect', 'line', 'dot'];
  return opts[Math.floor(srand(seed) * opts.length)];
}

function splitParagraphs(raw) {
  const byBlank = raw.split(/\n[ \t]*\n/).map(p => p.trim()).filter(p => p.length > 2);
  if (byBlank.length > 1) return byBlank;
  const byLine = raw.split(/\n/).map(l => l.trim()).filter(l => l.length > 2);
  if (byLine.length > 1) return byLine;
  return [raw.trim()].filter(s => s.length > 2);
}