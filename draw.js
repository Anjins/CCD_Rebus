const A4_W = 794;
const A4_H = 559;

const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');

function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = A4_W * dpr;
  canvas.height = (A4_H * 2) * dpr;
  canvas.style.width  = A4_W + 'px';
  canvas.style.height = (A4_H * 2) + 'px';
  ctx.scale(dpr, dpr);
}

function getStrokes(ch) {
  const g = skeletonData && skeletonData[ch];
  if (!g) return null;
  return Array.isArray(g) ? g : g.strokes;
}

function getMetrics(ch) {
  const g = skeletonData && skeletonData[ch];
  if (!g || Array.isArray(g)) return null;
  return g.metrics || null;
}

function strokeYBounds(strokes) {
  let yMin = Infinity, yMax = -Infinity;
  for (const s of strokes)
    for (const p of s) {
      if (p[1] < yMin) yMin = p[1];
      if (p[1] > yMax) yMax = p[1];
    }
  return { yMin, yMax };
}

function measureAdvance(txt) {
  let adv = 0;
  for (const c of txt) {
    if (c === ' ') { adv += 0.5; continue; }
    adv += (getMetrics(c) || { advance: 0.55 }).advance;
  }
  return adv;
}

function buildEmotionGradient(avg, yOffset) {
  const weighted = [];
  let totalW = 0;
  for (const [normKey, col] of Object.entries(EMO_COLORS)) {
    const ptKey = PLUTCHIK_PT.find(p => emoKey(p) === normKey) || normKey;
    const w = avg[ptKey] || 0;
    if (w > 0.02) { weighted.push({ col, w }); totalW += w; }
  }
  if (!weighted.length) { weighted.push({ col: [140, 140, 140], w: 1 }); totalW = 1; }
  weighted.sort((a, b) => b.w - a.w);

  const W = A4_W, H = A4_H;
  ctx.save();
  ctx.translate(0, yOffset);

  const domCol = weighted[0].col;
  ctx.fillStyle = `rgb(${Math.round(domCol[0] * 0.15)},${Math.round(domCol[1] * 0.15)},${Math.round(domCol[2] * 0.15)})`;
  ctx.fillRect(0, 0, W, H);

  const positions = [
    [0.15, 0.12], [0.85, 0.10], [0.05, 0.55],
    [0.95, 0.55], [0.50, 0.50], [0.25, 0.85],
    [0.75, 0.82], [0.50, 0.15],
  ];
  const spots = [];
  for (const item of weighted) {
    const count = Math.round((item.w / totalW) * positions.length);
    for (let i = 0; i < count; i++) spots.push(item);
  }
  while (spots.length < positions.length) spots.push(weighted[0]);
  spots.length = positions.length;

  for (let i = 0; i < positions.length; i++) {
    const [cx, cy] = positions[i];
    const spot = spots[i];
    const [r, g, b] = spot.col;
    const radius = Math.max(W, H) * (0.60 + (spot.w / totalW) * 0.45);
    const grad = ctx.createRadialGradient(cx * W, cy * H, 0, cx * W, cy * H, radius);
    grad.addColorStop(0,    `rgba(${r},${g},${b},0.85)`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},0.35)`);
    grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  const veil = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.3, W * 0.5, H * 0.5, W * 1.0);
  veil.addColorStop(0, 'rgba(0,0,0,0)');
  veil.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function computeLetterVariant(baseDensity, baseThickness, baseColor, tension, charCode, posInWord, wordLen, withColor, dominantEmo) {
  const seed        = charCode * 137 + posInWord * 31 + wordLen * 7;
  const spread      = 0.18 + tension * 0.62;
  const chaos       = withColor ? tension : 0.28;
  const densityMult = 1 + (srand(seed) - 0.5) * 2 * spread * 0.75;
  const thickMult   = 1 + (srand(seed + 1) - 0.5) * 2 * spread * 0.45;

  let baseColorHex = baseColor;
  if (!invertMode && withColor && tension > 0.05) {
    const hueShift   = (srand(seed + 2) - 0.5) * 28 * tension;
    const lightShift = (srand(seed + 3) - 0.5) * 14 * tension;
    const [h, s, l]  = rgbToHsl(...hexToRgb(baseColor));
    baseColorHex = hslToHex(
      ((h + hueShift) % 360 + 360) % 360, s,
      Math.max(5, Math.min(90, l + lightShift))
    );
  }

  const hueShiftG = 15 + chaos * 55;
  const [hG, sG, lG] = rgbToHsl(...hexToRgb(baseColorHex));
  const gradDir = srand(seed + 21) > 0.5 ? 1 : -1;
  const gradientColor = invertMode
    ? '#ffffff'
    : hslToHex(
        ((hG + gradDir * hueShiftG) % 360 + 360) % 360, sG,
        Math.max(10, Math.min(88, lG + (srand(seed + 22) - 0.5) * 18))
      );

  const primaryShape   = pickShapeType(dominantEmo, charCode, seed + 30);
  const secondaryShape = pickShapeType(dominantEmo, charCode, seed + 31);
  const shapeMixProb   = 0.15 + chaos * 0.40;
  const rawThickness   = Math.max(0.3, baseThickness * thickMult);

  return {
    density:       Math.max(5, baseDensity * densityMult),
    thickness:     Math.min(rawThickness, 1.6),
    color:         baseColorHex,
    spacingChaos:  withColor ? (0.12 + tension * 0.88) : 0.42,
    sizeVariance:  0.25 + chaos * 0.60,
    jitterAmt:     withColor ? tension * 2.4 : 0.5,
    rotJitter:     0.06 + chaos * 0.35,
    gradientColor,
    useGradient:   !invertMode,
    primaryShape,
    secondaryShape,
    shapeMixProb,
    wantFill:      isShapeFilled,
  };
}

function drawShapeAt(r, shapeType, wantFill) {
  ctx.beginPath();
  switch (shapeType) {
    case 'oval':     ctx.ellipse(0, 0, r, r * 0.40, 0, 0, Math.PI * 2); break;
    case 'rect':     ctx.rect(-r, -r * 0.40, r * 2, r * 0.80);          break;
    case 'triangle':
      ctx.moveTo(0, -r * 0.85);
      ctx.lineTo(r * 0.75, r * 0.50);
      ctx.lineTo(-r * 0.75, r * 0.50);
      ctx.closePath();
      break;
    case 'dot':  ctx.arc(0, 0, Math.max(0.3, r * 0.42), 0, Math.PI * 2); break;
    case 'line': ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke(); return;
    default:     ctx.ellipse(0, 0, r, r * 0.40, 0, 0, Math.PI * 2);
  }
  if (wantFill) ctx.fill(); else ctx.stroke();
}

function drawFillStroke(stroke, tx, ty, density, thickness, color, seed, variant) {
  if (stroke.length < 2 || density <= 0) return;
  const hasW         = stroke[0].length >= 3;
  const pxPerUnit    = tx(1) - tx(0);
  const spacingChaos = variant ? variant.spacingChaos : 0.42;
  const sizeVariance = variant ? variant.sizeVariance : 0.28;
  const jitterAmt    = variant ? variant.jitterAmt    : 0.5;
  const rotJitter    = variant ? variant.rotJitter    : 0.06;
  const effColor     = invertMode ? '#ffffff' : (variant ? variant.color : color);
  const effThick     = variant ? variant.thickness : thickness;
  const effDensity   = variant ? variant.density   : density;
  const primaryShape = variant ? variant.primaryShape  : 'oval';
  const secShape     = variant ? variant.secondaryShape : primaryShape;
  const shapeMixProb = variant ? variant.shapeMixProb  : 0;
  const gradColor    = invertMode ? '#ffffff' : ((variant && variant.gradientColor) ? variant.gradientColor : effColor);
  const useGradient  = invertMode ? false : (variant ? variant.useGradient : false);
  const wantFill     = variant ? variant.wantFill : isShapeFilled;
  const rgb1 = hexToRgb(effColor), rgb2 = hexToRgb(gradColor);

  const dists = [0];
  for (let i = 1; i < stroke.length; i++) {
    const dx = stroke[i][0] - stroke[i - 1][0], dy = stroke[i][1] - stroke[i - 1][1];
    dists.push(dists[dists.length - 1] + Math.hypot(dx, dy));
  }
  const totalLen = dists[dists.length - 1];
  if (totalLen === 0 || pxPerUnit === 0) return;

  const avgStep = 100 / (pxPerUnit * effDensity);
  let t = 0, idx = 0;

  while (t <= totalLen && idx < 4000) {
    let seg = 0;
    while (seg < dists.length - 2 && dists[seg + 1] < t) seg++;
    const span = dists[seg + 1] - dists[seg];
    const u    = span > 0 ? (t - dists[seg]) / span : 0;
    const px   = stroke[seg][0] + u * (stroke[seg + 1][0] - stroke[seg][0]);
    const py   = stroke[seg][1] + u * (stroke[seg + 1][1] - stroke[seg][1]);
    const pw   = hasW ? stroke[seg][2] + u * (stroke[seg + 1][2] - stroke[seg][2]) : null;
    const scx  = tx(px), scy = ty(py);
    const baseR = (pw !== null ? (pw / 2) * pxPerUnit : 14) * effThick;
    const sf    = 1 - sizeVariance * 0.5 + srand(seed + idx * 0.713) * sizeVariance;
    const r     = Math.max(0.3, baseR * sf);
    const s0    = Math.max(0, seg - 1), s1 = Math.min(stroke.length - 1, seg + 1);
    const angle = Math.atan2(ty(stroke[s1][1]) - ty(stroke[s0][1]), tx(stroke[s1][0]) - tx(stroke[s0][0]));
    const jx    = (srand(seed + idx * 1.337 + 50)  - 0.5) * jitterAmt;
    const jy    = (srand(seed + idx * 1.731 + 100) - 0.5) * jitterAmt;
    const rj    = (srand(seed + idx * 0.449 + 150) - 0.5) * rotJitter * Math.PI;

    let shapeColor;
    if (useGradient && totalLen > 0) {
      const p = t / totalLen;
      shapeColor = `rgb(${Math.round(rgb1[0] + p * (rgb2[0] - rgb1[0]))},${Math.round(rgb1[1] + p * (rgb2[1] - rgb1[1]))},${Math.round(rgb1[2] + p * (rgb2[2] - rgb1[2]))})`;
    } else { shapeColor = effColor; }

    const useSecShape      = srand(seed + idx * 2.771 + 400) < shapeMixProb;
    const shapeType        = useSecShape ? secShape : primaryShape;
    const opacityVariance  = 0.25 + (variant ? (variant.spacingChaos || 0) * 0.50 : 0.2);
    const baseOpacity      = invertMode ? 0.85 : 0.72;
    const opacity          = Math.max(0.18, Math.min(1.0, baseOpacity - srand(seed + idx * 1.919 + 500) * opacityVariance));

    ctx.save();
    ctx.translate(scx + jx, scy + jy);
    ctx.rotate(angle + rj);
    ctx.globalAlpha  = opacity;
    ctx.strokeStyle  = shapeColor;
    ctx.fillStyle    = shapeColor;
    ctx.lineWidth    = wantFill ? 0.6 : Math.max(0.8, effThick * 0.5);
    drawShapeAt(r, shapeType, wantFill);
    ctx.restore();

    const n  = srand(seed + idx * 2.113 + 200);
    let stepMult;
    if (spacingChaos < 0.01) {
      stepMult = 1;
    } else {
      const cp = spacingChaos * 0.32, gp = spacingChaos * 0.18;
      if      (n < cp)       stepMult = 0.08 + (n / cp) * 0.35;
      else if (n > 1 - gp)   stepMult = 1.4 + ((n - (1 - gp)) / gp) * (1.8 * spacingChaos);
      else                   stepMult = 0.55 + ((n - cp) / (1 - cp - gp)) * 0.9;
    }
    t += avgStep * Math.max(0.07, stepMult);
    idx++;
  }
}

function drawGlyphs(strokes, cursorX, baselineY, emPx, density, thickness, color, seed, variant) {
  const tx = x => cursorX + x * emPx;
  const ty = y => baselineY - y * emPx;
  strokes.forEach((s, si) => drawFillStroke(s, tx, ty, density, thickness, color, seed + si * 997, variant));
}

function draw() {
  const W = A4_W, H = A4_H;
  ctx.clearRect(0, 0, W, H * 2);
  wordBoxes = [];

  invertMode = true;
  if (overallAvgGlobal) {
    buildEmotionGradient(overallAvgGlobal, 0);
  } else {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);
  }
  if (skeletonData && textMode) drawTextMode(W, H, 0);

  invertMode = false;
  ctx.fillStyle = '#f9f8f6';
  ctx.fillRect(0, H, W, H);
  if (skeletonData && textMode) drawTextMode(W, H, H);
}

function drawTextMode(W, H, yOffset) {
  const raw   = document.getElementById('textInput').value;
  const lines = splitParagraphs(raw);
  if (!lines.length) return;

  const PAD_H = 50, PAD_V = 50, LINE_GAP_EM = 0.45;
  let inkYMin = Infinity, inkYMax = -Infinity;
  for (const line of lines) {
    for (const c of line) {
      if (c === ' ') continue;
      const s = getStrokes(c);
      if (!s || !s.length) continue;
      const b = strokeYBounds(s);
      if (b.yMin < inkYMin) inkYMin = b.yMin;
      if (b.yMax > inkYMax) inkYMax = b.yMax;
    }
  }
  if (!isFinite(inkYMin)) return;

  const inkH       = inkYMax - inkYMin;
  const totalH_em  = lines.length * inkH + (lines.length - 1) * LINE_GAP_EM;
  const maxAdv     = Math.max(...lines.map(measureAdvance), 0.1);
  let emPx = Math.min(
    (W - PAD_H * 2) / maxAdv,
    totalH_em > 0 ? (H - PAD_V * 2) / totalH_em : H
  ) * 0.94;

  const totalPxH     = totalH_em * emPx;
  const firstBaseline = (H - totalPxH) / 2 + inkYMax * emPx + yOffset;

  for (let li = 0; li < lines.length; li++) {
    const line       = lines[li];
    const pd         = paragraphData[li];
    const hasEmo     = pd && pd.params;
    const baseDensity   = hasEmo ? pd.params.density   : 60;
    const baseThickness = hasEmo ? pd.params.thickness  : 1.0;
    const baseColor     = invertMode ? '#ffffff' : (hasEmo ? pd.params.color : '#0a0a0a');
    const tension       = hasEmo ? pd.tensao : 0;
    const dominantEmo   = hasEmo ? getDominantEmo(pd.avg) : 'neutro';

    const rebusMatches = [];
    const wordsRaw = line.split(' ');
    let charOffset = 0;
    for (const w of wordsRaw) {
      const cleanW      = w.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '');
      const cleanWLower = cleanW.toLowerCase();
      if (cleanWLower.length > 3 && rebusWordsGlobal.has(cleanWLower)) {
        const rebusColor = invertMode ? '#ffffff' : baseColor;
        const ckey       = `${cleanWLower}_${rebusColor}_${dominantEmo}`;
        const ovKey      = `${cleanWLower}_${li}`;
        const ov         = wordOverrides[ovKey] || {};
        const overrideImg = invertMode ? ov.rebusImgInvert : ov.rebusImgNormal;
        const img        = overrideImg || (rebusCache[ckey] && rebusCache[ckey] !== 'error' ? rebusCache[ckey] : null);
        if (img) rebusMatches.push({ start: charOffset, length: cleanW.length, word: cleanWLower, img });
      }
      charOffset += w.length + 1;
    }

    let realLinePx = 0;
    for (let ci = 0; ci < line.length;) {
      const rm = rebusMatches.find(m => m.start === ci);
      if (rm) {
        const scale = (inkH * emPx) / rm.img.height;
        realLinePx += rm.img.width * scale + 0.5 * emPx;
        ci += rm.length;
        continue;
      }
      const c = line[ci];
      realLinePx += (c === ' ' ? 0.5 : (getMetrics(c) || { advance: 0.55 }).advance) * emPx;
      ci++;
    }

    const baselineY = firstBaseline + li * (inkH + LINE_GAP_EM) * emPx;
    let curX        = (W - realLinePx) / 2;

    const wordSpans = [];
    let spanStart = -1, spanStr = '';
    for (let ci = 0; ci < line.length; ci++) {
      const rm = rebusMatches.find(m => m.start === ci);
      if (rm) {
        if (spanStart !== -1) { wordSpans.push({ word: spanStr, startCi: spanStart, endCi: ci - 1, isRebus: false }); spanStart = -1; spanStr = ''; }
        wordSpans.push({ word: rm.word, startCi: ci, endCi: ci + rm.length - 1, isRebus: true, img: rm.img, rmLen: rm.length });
        ci += rm.length - 1;
      } else if (line[ci] === ' ') {
        if (spanStart !== -1) { wordSpans.push({ word: spanStr, startCi: spanStart, endCi: ci - 1, isRebus: false }); spanStart = -1; spanStr = ''; }
      } else {
        if (spanStart === -1) { spanStart = ci; spanStr = ''; }
        spanStr += line[ci];
      }
    }
    if (spanStart !== -1) wordSpans.push({ word: spanStr, startCi: spanStart, endCi: line.length - 1, isRebus: false });

    const spanX1 = {};

    let ci = 0;
    while (ci < line.length) {
      const rm = rebusMatches.find(m => m.start === ci);
      if (rm) {
        const h         = inkH * emPx, scale = h / rm.img.height, w = rm.img.width * scale;
        const marginPx  = 0.25 * emPx;
        const x1 = curX, y1 = baselineY - inkYMax * emPx;
        const x2 = curX + w + marginPx * 2, y2 = baselineY - inkYMin * emPx;
        const key = `${rm.word}_${li}`;
        const ov  = wordOverrides[key] || {};

        wordBoxes.push({ word: rm.word, lineIdx: li, isRebus: true, img: rm.img, x1, y1, x2, y2, ov });

        ctx.save();
        if (ov.emocoes) ctx.globalAlpha = 0.9;
        ctx.drawImage(rm.img, curX + marginPx, y1, w, h);
        ctx.restore();

        const isSelected = selectedWord && selectedWord.word === rm.word && selectedWord.lineIdx === li && selectedWord.isRebus;
        if (isSelected) {
          ctx.save();
          ctx.strokeStyle = invertMode ? 'rgba(255,255,255,0.7)' : '#0a0a0a';
          ctx.lineWidth = 1;
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.restore();
        }

        curX = x2;
        ci  += rm.length;
        continue;
      }

      const c = line[ci];
      if (c === ' ') { curX += 0.5 * emPx; ci++; continue; }

      const span      = wordSpans.find(s => !s.isRebus && ci >= s.startCi && ci <= s.endCi);
      const fullWord  = span ? span.word : c;
      const posInWord = span ? ci - span.startCi : 0;
      const key       = `${fullWord}_${li}`;

      if (span && spanX1[key] === undefined) spanX1[key] = curX;

      const strokes = getStrokes(c);
      const m       = getMetrics(c);
      const adv     = m ? m.advance : 0.55;

      if (strokes && strokes.length) {
        const ov       = wordOverrides[key] || {};
        const effDen   = ov.density    !== undefined ? ov.density    : baseDensity;
        const effThk   = ov.thickness  !== undefined ? ov.thickness  : baseThickness;
        const effColor = invertMode ? '#ffffff' : (ov.color !== undefined ? ov.color : baseColor);
        const effEmo   = ov.emocoes || pd?.avg;
        const effDom   = effEmo ? getDominantEmo(effEmo) : dominantEmo;
        const variant  = computeLetterVariant(effDen, effThk, effColor, tension, c.charCodeAt(0), posInWord, fullWord.length, hasEmo, effDom);
        drawGlyphs(strokes, curX, baselineY, emPx, variant.density, variant.thickness, effColor, li * 1000000 + ci * 100, variant);
      }

      curX += adv * emPx;

      if (span && ci === span.endCi) {
        const ov = wordOverrides[key] || {};
        const x1 = spanX1[key], x2 = curX;
        const y1 = baselineY - inkYMax * emPx, y2 = baselineY - inkYMin * emPx;
        wordBoxes.push({ word: span.word, lineIdx: li, isRebus: false, x1, y1, x2, y2, ov });

        const isSelected = selectedWord && selectedWord.word === span.word && selectedWord.lineIdx === li && !selectedWord.isRebus;
        if (isSelected) {
          ctx.save();
          ctx.fillStyle   = invertMode ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)';
          ctx.fillRect(x1, y1, x2 - x1, inkH * emPx);
          ctx.strokeStyle = invertMode ? 'rgba(255,255,255,0.7)' : '#0a0a0a';
          ctx.lineWidth   = 1;
          ctx.strokeRect(x1, y1, x2 - x1, inkH * emPx);
          ctx.restore();
        }
      }
      ci++;
    }
  }
}