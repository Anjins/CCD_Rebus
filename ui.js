function setBusy(msg) {
  const b = document.getElementById('statusBtn');
  b.textContent = msg;
  b.classList.add('busy');
}

function setReady() {
  const b = document.getElementById('statusBtn');
  b.textContent = 'Pronto';
  b.classList.remove('busy');
}

function clearText() {
  document.getElementById('textInput').value = '';
  document.getElementById('emotionSection').style.display = 'none';
  document.getElementById('selEditor').classList.remove('visible');
  setReady();
  const logo = document.getElementById('brandLogo');
  if (logo) logo.style.color = 'var(--black)';

  textMode            = false;
  paragraphData       = [];
  selectedWord        = null;
  wordBoxes           = [];
  wordOverrides       = {};
  overallAvgGlobal    = null;
  overallTensaoGlobal = 0;
  rebusWordsGlobal.clear();
  draw();
}

function renderEmotionBar(avg, tensao) {
  const bar = document.getElementById('emotionBar');
  bar.innerHTML = PLUTCHIK_PT.map(name => {
    const normK = emoKey(name);
    const col   = EMO_COLORS[normK] || [120, 120, 120];
    const val   = avg[name] || 0;
    const rgb   = `rgb(${col[0]},${col[1]},${col[2]})`;
    return `<div class="emo-row">
      <span class="emo-name">${name}</span>
      <div class="emo-track"><div class="emo-fill" style="width:${Math.round(val * 100)}%;background:${rgb}"></div></div>
      <span class="emo-val">${Math.round(val * 100)}</span>
    </div>`;
  }).join('');
  document.getElementById('tensionFill').style.width = Math.round((tensao || 0) * 100) + '%';
  document.getElementById('tensionVal').textContent  = Math.round((tensao || 0) * 100);
}

canvas.addEventListener('mousemove', e => {
  if (!textMode) return;
  const { cx, cy } = canvasPt(e);
  const hover = wordBoxes.find(b => cx >= b.x1 && cx <= b.x2 && cy >= b.y1 && cy <= b.y2);
  canvas.style.cursor = hover ? 'pointer' : 'default';
});

canvas.addEventListener('click', e => {
  if (!textMode) return;
  const { cx, cy } = canvasPt(e);
  const hit = wordBoxes.find(b => cx >= b.x1 && cx <= b.x2 && cy >= b.y1 && cy <= b.y2);
  if (hit) {
    selectedWord = hit;
    openSelEditor(hit);
  } else {
    selectedWord = null;
    document.getElementById('selEditor').classList.remove('visible');
  }
  draw();
});

function canvasPt(e) {
  const rect = canvas.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  return {
    cx: (e.clientX - rect.left) * (canvas.width  / rect.width)  / dpr,
    cy: (e.clientY - rect.top)  * (canvas.height / rect.height) / dpr,
  };
}

function wordKey(box) { return `${box.word}_${box.lineIdx}`; }

function openSelEditor(box) {
  const key = wordKey(box);
  const ov  = wordOverrides[key] || {};
  const pd  = paragraphData[box.lineIdx];

  document.getElementById('selEditor').classList.add('visible');
  document.getElementById('selWord').textContent = box.word;
  document.getElementById('selType').textContent = box.isRebus ? 'ícone' : 'palavra';

  const picker  = document.getElementById('iconPicker');
  const sliders = document.getElementById('nonRebusSliders');
  if (box.isRebus) {
    picker.classList.add('visible');
    sliders.style.display = 'none';
    openIconPicker(box);
  } else {
    picker.classList.remove('visible');
    sliders.style.display = '';
  }

  const den = ov.density    !== undefined ? ov.density    : (pd && pd.params ? pd.params.density    : 60);
  const thk = ov.thickness  !== undefined ? ov.thickness  : (pd && pd.params ? pd.params.thickness  : 1.0);
  document.getElementById('selDensity').value   = den;
  document.getElementById('selThickness').value = thk;
  document.getElementById('selDensityVal').textContent   = Math.round(den);
  document.getElementById('selThicknessVal').textContent = parseFloat(thk).toFixed(1);

  const baseAvg = (pd && pd.avg) ? { ...pd.avg } : Object.fromEntries(PLUTCHIK_PT.map(e => [e, 0]));
  const curAvg  = ov.emocoes ? { ...ov.emocoes } : { ...baseAvg };
  const editors = document.getElementById('selEmoEditors');
  editors.innerHTML = PLUTCHIK_PT.map(name => {
    const val   = Math.round((curAvg[name] || 0) * 100);
    const normK = emoKey(name);
    const col   = EMO_COLORS[normK] || [120, 120, 120];
    return `<div class="emo-edit-row">
      <label>${name}</label>
      <input type="range" min="0" max="100" value="${val}"
        style="accent-color:rgb(${col[0]},${col[1]},${col[2]})"
        oninput="onSelEmo(this,'${name}')">
      <span class="emo-edit-val" id="eev_${emoKey(name)}">${val}</span>
    </div>`;
  }).join('');
}

function onSelSlider() {
  if (!selectedWord) return;
  const key = wordKey(selectedWord);
  if (!wordOverrides[key]) wordOverrides[key] = {};
  wordOverrides[key].density   = Number(document.getElementById('selDensity').value);
  wordOverrides[key].thickness = Number(document.getElementById('selThickness').value);
  document.getElementById('selDensityVal').textContent   = Math.round(wordOverrides[key].density);
  document.getElementById('selThicknessVal').textContent = wordOverrides[key].thickness.toFixed(1);
  draw();
}

function onSelEmo(el, name) {
  if (!selectedWord) return;
  const key = wordKey(selectedWord);
  if (!wordOverrides[key]) wordOverrides[key] = {};
  if (!wordOverrides[key].emocoes) {
    const pd = paragraphData[selectedWord.lineIdx];
    wordOverrides[key].emocoes = pd && pd.avg
      ? { ...pd.avg }
      : Object.fromEntries(PLUTCHIK_PT.map(e => [e, 0]));
  }
  wordOverrides[key].emocoes[name] = el.value / 100;
  document.getElementById(`eev_${emoKey(name)}`).textContent = el.value;
  wordOverrides[key].color = blendEmotionColor(wordOverrides[key].emocoes);
  recomputeOverallAvg();
  draw();
}

function resetSelection() {
  if (!selectedWord) return;
  delete wordOverrides[wordKey(selectedWord)];
  recomputeOverallAvg();
  openSelEditor(selectedWord);
  draw();
}

const iconOpcoesCache   = {};
const iconOpcoesLoading = new Set();

function iconPickerKey(palavra, emocao) { return `${palavra}_${emocao}`; }

async function loadIconOpcoes(palavra, emocao) {
  const key = iconPickerKey(palavra, emocao);
  if (iconOpcoesCache[key]) return iconOpcoesCache[key];
  if (iconOpcoesLoading.has(key)) return null;
  iconOpcoesLoading.add(key);
  try {
    const res = await fetch(`/gerar-rebus-opcoes?palavra=${encodeURIComponent(palavra)}&emocao=${encodeURIComponent(emocao)}&max_opcoes=8`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    iconOpcoesCache[key] = data;
    return data;
  } catch (e) {
    console.error('loadIconOpcoes:', e);
    return null;
  } finally {
    iconOpcoesLoading.delete(key);
  }
}

function renderIconGrid(opcoes, escolhidoAtual, palavra, emocao, lineIdx) {
  const grid    = document.getElementById('iconGrid');
  const loading = document.getElementById('iconLoading');

  if (!opcoes || opcoes.length === 0) {
    loading.textContent    = 'Sem opções disponíveis.';
    loading.style.display  = '';
    grid.innerHTML         = '';
    return;
  }

  loading.style.display = 'none';
  grid.innerHTML        = '';

  const key      = `${palavra}_${lineIdx}`;
  const ov       = wordOverrides[key] || {};
  const activeIcon = ov.iconOverride || null;

  opcoes.forEach((iconId, idx) => {
    const cell = document.createElement('div');
    cell.className = 'icon-opt' + ((!activeIcon && idx === 0) || activeIcon === iconId ? ' selected' : '');
    cell.title = iconId;

    const pd        = paragraphData[lineIdx];
    const baseColor = pd && pd.params ? pd.params.color : '#0a0a0a';

    const imgDark = document.createElement('img');
    imgDark.className = 'img-dark';
    imgDark.src = `/gerar-rebus?palavra=${encodeURIComponent(palavra)}&color=${encodeURIComponent(baseColor)}&emocao=${encodeURIComponent(emocao)}&icone=${encodeURIComponent(iconId)}`;
    imgDark.alt = iconId;

    const imgLight = document.createElement('img');
    imgLight.className = 'img-light';
    imgLight.src = `/gerar-rebus?palavra=${encodeURIComponent(palavra)}&color=%23ffffff&emocao=${encodeURIComponent(emocao)}&icone=${encodeURIComponent(iconId)}`;
    imgLight.alt = iconId;

    const name = document.createElement('div');
    name.className   = 'icon-name';
    name.textContent = iconId.split(':')[1] || iconId;

    const wrap = document.createElement('div');
    wrap.className = 'icon-img-wrap';
    wrap.appendChild(imgDark);
    wrap.appendChild(imgLight);
    cell.appendChild(wrap);
    cell.appendChild(name);

    cell.addEventListener('click', () => onIconSelect(iconId, idx, palavra, emocao, lineIdx));
    grid.appendChild(cell);
  });
}

async function openIconPicker(box) {
  const picker  = document.getElementById('iconPicker');
  const loading = document.getElementById('iconLoading');
  const grid    = document.getElementById('iconGrid');

  picker.classList.add('visible');
  loading.textContent   = 'A carregar opções…';
  loading.style.display = '';
  grid.innerHTML        = '';

  const pd     = paragraphData[box.lineIdx];
  const emocao = pd && pd.avg ? getDominantEmo(pd.avg) : 'neutro';
  const key    = iconPickerKey(box.word, emocao);

  if (iconOpcoesCache[key]) {
    renderIconGrid(iconOpcoesCache[key].opcoes, iconOpcoesCache[key].escolhido, box.word, emocao, box.lineIdx);
    return;
  }

  const result = await loadIconOpcoes(box.word, emocao);
  if (selectedWord && selectedWord.word === box.word && selectedWord.lineIdx === box.lineIdx) {
    renderIconGrid(result ? result.opcoes : [], result ? result.escolhido : null, box.word, emocao, box.lineIdx);
  }
}

async function onIconSelect(iconId, idx, palavra, emocao, lineIdx) {
  const key = `${palavra}_${lineIdx}`;
  if (!wordOverrides[key]) wordOverrides[key] = {};
  wordOverrides[key].iconOverride = idx === 0 ? null : iconId;

  const pd          = paragraphData[lineIdx];
  const colorNormal = pd && pd.params ? pd.params.color : '#0a0a0a';
  const colorInvert = '#ffffff';
  const iconParam   = idx === 0 ? '' : `&icone=${encodeURIComponent(iconId)}`;

  const loadImg = src => new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => resolve('error');
    img.src = src;
  });

  const [imgN, imgI] = await Promise.all([
    loadImg(`/gerar-rebus?palavra=${encodeURIComponent(palavra)}&color=${encodeURIComponent(colorNormal)}&emocao=${encodeURIComponent(emocao)}${iconParam}`),
    loadImg(`/gerar-rebus?palavra=${encodeURIComponent(palavra)}&color=${encodeURIComponent(colorInvert)}&emocao=${encodeURIComponent(emocao)}${iconParam}`),
  ]);

  wordOverrides[key].rebusImgNormal = imgN !== 'error' ? imgN : null;
  wordOverrides[key].rebusImgInvert = imgI !== 'error' ? imgI : null;

  document.getElementById('iconGrid').querySelectorAll('.icon-opt').forEach((cell, i) => {
    cell.classList.toggle('selected', i === idx);
  });

  draw();
}

async function exportPDF() {
  if (!textMode) return;
  setBusy('A exportar…');
  await new Promise(r => setTimeout(r, 60));

  const dpr  = window.devicePixelRatio || 1;
  const cW   = canvas.width  / dpr;
  const cH   = canvas.height / dpr;

  function sliceCanvas(srcY, srcH) {
    const tmp = document.createElement('canvas');
    tmp.width  = canvas.width;
    tmp.height = srcH * dpr;
    const tc = tmp.getContext('2d');
    tc.drawImage(canvas, 0, srcY * dpr, canvas.width, srcH * dpr, 0, 0, canvas.width, srcH * dpr);
    return tmp.toDataURL('image/jpeg', 0.95);
  }

  const halfH    = cH / 2;
  const imgColor = sliceCanvas(0,      halfH);
  const imgWhite = sliceCanvas(halfH,  halfH);

  const A5L_W = 595.28, A5L_H = 419.53;
  const scale  = Math.min(A5L_W / cW, A5L_H / halfH);
  const drawW  = cW * scale, drawH = halfH * scale;
  const offX   = (A5L_W - drawW) / 2, offY = (A5L_H - drawH) / 2;

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a5' });
    pdf.addImage(imgColor, 'JPEG', offX, offY, drawW, drawH);
    pdf.addPage('a5', 'landscape');
    pdf.addImage(imgWhite, 'JPEG', offX, offY, drawW, drawH);
    pdf.save('rebus-composition.pdf');
  } catch (e) {
    console.error('exportPDF:', e);
    alert('Erro ao exportar PDF. Tente novamente.');
  }
  setReady();
}