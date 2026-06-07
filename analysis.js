const TYPING_DELAY = 650;
let typingTimer;

function emoToParams(avg, tensao) {
  const get = k => avg[k] || avg[PLUTCHIK_PT.find(p => emoKey(p) === emoKey(k))] || 0;
  const rawThick = 0.6 + Math.max(get('raiva'), get('medo')) * 3.2;
  return {
    density:   Math.round(5 + tensao * 155),
    thickness: +Math.min(rawThick, 1.6).toFixed(2),
    color:     blendEmotionColor(avg),
  };
}

let _loadBgCanvas = null;

function _ensureLoadBgCanvas() {
  if (_loadBgCanvas) return _loadBgCanvas;
  const ov = document.getElementById('loadingOverlay');
  const bg = document.createElement('canvas');
  bg.setAttribute('aria-hidden', 'true');
  ov.insertBefore(bg, ov.firstChild);
  _loadBgCanvas = bg;
  return bg;
}

function _paintLoadGradient(avg) {
  const bc   = _ensureLoadBgCanvas();
  const wrap = document.getElementById('loadingOverlay');
  const W    = wrap ? wrap.offsetWidth  : 900;
  const H    = wrap ? wrap.offsetHeight : 700;
  bc.width   = W;
  bc.height  = H;
  const c   = bc.getContext('2d');

  const weighted = [];
  let totalW = 0;
  for (const [normKey, col] of Object.entries(EMO_COLORS)) {
    const ptKey = PLUTCHIK_PT.find(p => emoKey(p) === normKey) || normKey;
    const w = avg[ptKey] || 0;
    if (w > 0.01) { weighted.push({ col, w }); totalW += w; }
  }
  if (!weighted.length) { weighted.push({ col: [80, 80, 80], w: 1 }); totalW = 1; }
  weighted.sort((a, b) => b.w - a.w);

  const domCol = weighted[0].col;
  c.fillStyle = `rgb(${Math.round(domCol[0] * 0.12)},${Math.round(domCol[1] * 0.12)},${Math.round(domCol[2] * 0.12)})`;
  c.fillRect(0, 0, W, H);

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
    const s = spots[i];
    const [r, g, b] = s.col;
    const radius = Math.max(W, H) * (0.60 + (s.w / totalW) * 0.45);
    const grad = c.createRadialGradient(cx * W, cy * H, 0, cx * W, cy * H, radius);
    grad.addColorStop(0,    `rgba(${r},${g},${b},0.88)`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},0.35)`);
    grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
  }

  const veil = c.createRadialGradient(W * 0.5, H * 0.5, W * 0.3, W * 0.5, H * 0.5, W * 1.0);
  veil.addColorStop(0, 'rgba(0,0,0,0)');
  veil.addColorStop(1, 'rgba(0,0,0,0.60)');
  c.fillStyle = veil;
  c.fillRect(0, 0, W, H);
}

function showLoadingOverlay(pct) {
  const avg = overallAvgGlobal || { tristeza: 0.45, medo: 0.30, surpresa: 0.25 };
  _paintLoadGradient(avg);
  document.getElementById('loadingProgress').style.transition = 'none';
  document.getElementById('loadingProgress').style.width = (pct || 0) + '%';
  document.getElementById('loadingOverlay').classList.add('visible');
}

function setLoadingProgress(pct) {
  const fill = document.getElementById('loadingProgress');
  if (fill) {
    fill.style.transition = 'width 0.5s cubic-bezier(0.4,0,0.2,1)';
    fill.style.width = pct + '%';
  }
}

function hideLoadingOverlay() {
  document.getElementById('loadingOverlay').classList.remove('visible');
}

document.getElementById('textInput').addEventListener('input', () => {
  const ta = document.getElementById('textInput');
  const cursor = ta.selectionStart;
  const cleaned = ta.value.split('\n').filter(l => l.trim() !== '').join('\n');
  if (cleaned !== ta.value) {
    ta.value = cleaned;
    ta.setSelectionRange(cursor, cursor);
  }
  textMode = ta.value.length > 0;
  clearTimeout(typingTimer);
  if (textMode) {
    setBusy('A pensar…');
    typingTimer = setTimeout(analyzeText, TYPING_DELAY);
  } else {
    clearText();
  }
  draw();
});

async function analyzeText() {
  const raw        = document.getElementById('textInput').value;
  const lines      = splitParagraphs(raw);
  const intensidade = 1.0;
  if (!lines.length || !skeletonData) return;

  setBusy('A analisar…');
  showLoadingOverlay(5);

  paragraphData = [];
  rebusWordsGlobal.clear();
  overallAvgGlobal    = null;
  overallTensaoGlobal = 0;

  try {
    for (const para of lines) {
      const res = await fetch('/analisar-narrativa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: para, intensidade_rebus: intensidade }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();

      if (result.rebus_words) result.rebus_words.forEach(w => rebusWordsGlobal.add(w.toLowerCase()));

      const frases = result.evolucao_frases || [];
      if (!frases.length) { paragraphData.push({ text: para, params: null }); continue; }

      const avg = Object.fromEntries(PLUTCHIK_PT.map(e => [e, 0]));
      let avgTensao = 0;
      frases.forEach(f => {
        PLUTCHIK_PT.forEach(e => { avg[e] += (f.emocoes[e] || 0); });
        avgTensao += f.tensao;
      });
      PLUTCHIK_PT.forEach(e => { avg[e] /= frases.length; });
      avgTensao /= frases.length;

      paragraphData.push({ text: para, params: emoToParams(avg, avgTensao), avg, tensao: avgTensao });
    }

    const overallAvg = Object.fromEntries(PLUTCHIK_PT.map(e => [e, 0]));
    let overallTensao = 0, n = 0;
    paragraphData.forEach(p => {
      if (!p.avg) return;
      PLUTCHIK_PT.forEach(e => { overallAvg[e] += p.avg[e]; });
      overallTensao += p.tensao;
      n++;
    });

    if (n > 0) {
      PLUTCHIK_PT.forEach(e => { overallAvg[e] /= n; });
      overallTensao /= n;
      overallAvgGlobal    = overallAvg;
      overallTensaoGlobal = overallTensao;
      renderEmotionBar(overallAvg, overallTensao);

      _paintLoadGradient(overallAvg);
      setLoadingProgress(72);

      const emocaoDom = getDominantEmo(overallAvg);
      try {
        const skRes = await fetch(`/skeleton?emocao=${encodeURIComponent(emocaoDom)}`);
        if (skRes.ok) skeletonData = await skRes.json();
      } catch (e) {
        console.warn('Skeleton não carregado para', emocaoDom, e);
      }

      const logo = document.getElementById('brandLogo');
      if (logo) logo.style.color = blendEmotionColor(overallAvg);
    }

    document.getElementById('emotionSection').style.display = '';
    setBusy('A compor…');

    await loadRebusImagesAndDraw();

    setLoadingProgress(100);
    setTimeout(hideLoadingOverlay, 350);
    setReady();
  } catch (err) {
    console.error('analyzeText:', err);
    hideLoadingOverlay();
    setBusy('Erro');
    setTimeout(setReady, 3000);
  }
}

async function loadRebusImagesAndDraw() {
  const promises = [];

  paragraphData.forEach((pd, _li) => {
    const colorNormal  = pd.params ? pd.params.color : '#0a0a0a';
    const colorInvert  = '#ffffff';
    const dominantEmo  = pd.params ? getDominantEmo(pd.avg) : 'neutro';

    pd.text.split(' ').filter(Boolean).forEach(w => {
      const cleanW = w.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '').toLowerCase();
      if (cleanW.length > 3 && rebusWordsGlobal.has(cleanW)) {

        const ckeyN = `${cleanW}_${colorNormal}_${dominantEmo}`;
        if (!rebusCache[ckeyN]) {
          promises.push(new Promise(resolve => {
            const img = new Image();
            img.onload  = () => { rebusCache[ckeyN] = img; resolve(); };
            img.onerror = () => { rebusCache[ckeyN] = 'error'; resolve(); };
            img.src = `/gerar-rebus?palavra=${encodeURIComponent(cleanW)}&color=${encodeURIComponent(colorNormal)}&emocao=${encodeURIComponent(dominantEmo)}`;
          }));
        }

        const ckeyI = `${cleanW}_${colorInvert}_${dominantEmo}`;
        if (!rebusCache[ckeyI]) {
          promises.push(new Promise(resolve => {
            const img = new Image();
            img.onload  = () => { rebusCache[ckeyI] = img; resolve(); };
            img.onerror = () => { rebusCache[ckeyI] = 'error'; resolve(); };
            img.src = `/gerar-rebus?palavra=${encodeURIComponent(cleanW)}&color=${encodeURIComponent(colorInvert)}&emocao=${encodeURIComponent(dominantEmo)}`;
          }));
        }
      }
    });
  });

  await Promise.all(promises);
  draw();
}

function recomputeOverallAvg() {
  if (!paragraphData.length) return;

  const newOverall  = Object.fromEntries(PLUTCHIK_PT.map(e => [e, 0]));
  let newTensao = 0, n = 0;

  paragraphData.forEach((pd, li) => {
    if (!pd.avg) return;

    const words    = pd.text.split(' ').filter(Boolean);
    const wordAvgs = [];

    words.forEach(w => {
      const clean = w.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '').toLowerCase();
      if (!clean) return;
      const key = `${clean}_${li}`;
      const ov  = wordOverrides[key];
      wordAvgs.push(ov && ov.emocoes ? ov.emocoes : pd.avg);
    });

    if (!wordAvgs.length) wordAvgs.push(pd.avg);

    const paraAvg = Object.fromEntries(PLUTCHIK_PT.map(e => [e, 0]));
    wordAvgs.forEach(avg => { PLUTCHIK_PT.forEach(e => { paraAvg[e] += (avg[e] || 0); }); });
    PLUTCHIK_PT.forEach(e => { paraAvg[e] /= wordAvgs.length; });

    PLUTCHIK_PT.forEach(e => { newOverall[e] += paraAvg[e]; });
    newTensao += pd.tensao;
    n++;
  });

  if (!n) return;
  PLUTCHIK_PT.forEach(e => { newOverall[e] /= n; });
  newTensao /= n;

  overallAvgGlobal    = newOverall;
  overallTensaoGlobal = newTensao;
  renderEmotionBar(newOverall, newTensao);
  const logo = document.getElementById('brandLogo');
  if (logo) logo.style.color = blendEmotionColor(newOverall);
}