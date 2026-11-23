const $ = id => document.getElementById(id);
const colors = ['#59e2ba', '#bc91ff', '#ffb65b', '#69baff', '#ff7295'];
let session = null, selected = new Set(), reference = null, t = 0, playing = false;
let last = 0, zoom = 1, pan = [0, 0], drag = null, objectUrl = null, hasVideo = false;
let latest = null, revision = null, pendingSeek = null, chartDragging = false;
let liveHistory = [], lastLiveStamp = null, legendKey = null, toastTimer;
let chartRange = null, liveChartSpan = 20, liveChartOffset = 0;
let sessionRpmPeak = 0, liveRpmPeak = 0, liveRpmCar = null;
const scaleCache = new Map();
for (let i=0;i<16;i++) { const led=document.createElement('i'),pair=Math.min(i,15-i); led.style.setProperty('--led-color',pair<4?'#59e2ba':pair<6?'#ffc66e':'#f77d94'); $('rev-lights').append(led); }
const metricDefs = [
  {key:'speed', name:'Velocidad', unit:'km/h', decimals:0},
  {key:'rpm', name:'Revoluciones', unit:'RPM', decimals:0},
  {key:'throttle', name:'Acelerador', unit:'%', decimals:0, max:100},
  {key:'brake', name:'Freno', unit:'%', decimals:0, max:100},
  {key:'lapTime', name:'Tiempo de vuelta', unit:'min', decimals:3, divisor:60},
  {key:'raceTime', name:'Tiempo de carrera', unit:'min', decimals:3, divisor:60},
  {key:'d', name:'Distancia', unit:'m', decimals:0}
];
const tireLabels = ['Del. izq.', 'Del. der.', 'Tras. izq.', 'Tras. der.'];
for (let index=0; index<4; index++) {
  const tile = document.createElement('div');
  tile.className = 'tire-tile'; tile.id = 'tire-' + index;
  tile.innerHTML = `<svg viewBox="0 0 30 50" aria-hidden="true"><rect x="5" y="3" width="20" height="44" rx="7" class="tire-body"/><path d="m10 7 10 6-10 6 10 6-10 6 10 6-10 6" class="tire-tread"/></svg><div class="tire-info"><span>${tireLabels[index]}</span><output id="tire-temp-${index}">—</output><small id="tire-slip-${index}">Sin datos</small><div class="slip-meter"><i id="tire-slip-bar-${index}"></i><em></em></div></div>`;
  $('tire-grid').append(tile);
}
for (const [index, metric] of metricDefs.entries()) {
  const card = document.createElement('article');
  card.className = 'metric-card';
  card.innerHTML = `<div class="metric-heading"><h3 class="metric-name">${metric.name}</h3><div class="metric-number"><output id="value-${metric.key}">—</output><span class="metric-unit">${metric.unit}</span></div></div><canvas id="${index === 0 ? 'charts' : 'chart-' + metric.key}" aria-label="${metric.name} por distancia" data-key="${metric.key}"></canvas>`;
  $('telemetry-rows').append(card);
}

function setMenu(open) {
  if(open)setSessionPicker(false);
  $('session-menu').hidden = !open;
  $('menu-backdrop').hidden = !open;
  $('menu-toggle').setAttribute('aria-expanded', String(open));
  $('menu-toggle').setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  $('workspace').inert = open;
  $('player').inert = open;
  if (open) $('menu-close').focus(); else $('menu-toggle').focus();
}
$('menu-toggle').onclick = () => setMenu($('session-menu').hidden);
$('menu-close').onclick = $('menu-backdrop').onclick = () => setMenu(false);
document.addEventListener('keydown', event => {
  if ($('session-menu').hidden) return;
  if (event.key === 'Escape') { setMenu(false); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...$('session-menu').querySelectorAll('button,input,select,summary,[tabindex="0"]')]
    .filter(element => !element.disabled && element.getClientRects().length);
  const first = focusable[0], end = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); end?.focus(); }
  else if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); first?.focus(); }
});
new MutationObserver(() => {
  $('message').hidden = !$('message').textContent;
  clearTimeout(toastTimer);
  if (!$('message').hidden) toastTimer = setTimeout(() => { $('message').hidden = true; }, 7000);
}).observe($('message'), {childList:true, characterData:true, subtree:true});

async function api(path, body) {
  const response = await fetch('/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
}
function action(fn) {
  return async () => { try { await fn(); } catch (e) { $('message').textContent = e.message; } };
}
async function list() {
  const sessions = await api('sessions');
  renderPickerSessions(sessions);
  $('sessions').replaceChildren();
  for (const item of sessions) {
    const button = document.createElement('button');
    button.textContent = `${item.name} · ${new Date(item.created * 1000).toLocaleString()}${item.version === 2 && !item.ended ? ' · abierta' : ''}`;
    button.classList.toggle('selected', session?.meta.id === item.id);
    button.onclick = action(async () => { await load(item.id); setMenu(false); });
    $('sessions').append(button);
  }
}

function clearVideo() {
  $('video').pause(); $('compare-video').pause(); $('compare-video').removeAttribute('src'); $('compare-video').load();
  $('video').removeAttribute('src');
  $('video').load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  hasVideo = false;
  $('video-empty').hidden = false;
}
async function load(id) {
  setPlaying(false);
  clearVideo();
  session = await api('sessions/' + id);
  setViewLayout(false);history.replaceState(null,'','#session/'+id);
  sessionRpmPeak = session.laps.reduce((peak,lap)=>lap.rows.reduce((max,row)=>Number.isFinite(row.rpm)?Math.max(max,row.rpm):max,peak),0);
  scaleCache.clear(); chartRange = null; legendKey = null; $('telemetry-scroll').scrollTop = 0;
  selected = new Set(session.laps.map(lap => lap.id));
  reference = session.laps[0]?.id ?? null;
  $('title').textContent = session.meta.name;
  $('offset').value = session.meta.offset || 0;
  $('session-info').textContent = `Clase ${session.meta.carClass ?? '—'} · PI ${session.meta.carPI ?? '—'} · ${session.laps.reduce((n, l) => n + l.rows.length, 0)} muestras${session.meta.ended ? '' : ' · Usa Actualizar para recargar una sesión abierta'}`;
  allMode=true; allRows=RaceAnalysis.sessionRows(session.laps); videoChoices=[];
  renderCarBadges(); renderAnalysisMenu(); refreshTransport();
  $('show-live').hidden = false;
  t = 0; zoom = 1; pan = [0, 0];
  if (session.meta.videoPath) {
    hasVideo = true;
    $('video-empty').hidden = true;
    $('video').src = '/api/video/' + id;
    $('video-status').textContent = 'Video asociado por OBS. Si tu navegador no admite el formato, remultiplexa a MP4 H.264 y ábrelo con «Abrir video local».';
  } else {
    $('video-status').textContent = 'Sin video asociado. Puedes abrir uno local; las sesiones antiguas admiten ajuste manual.';
  }
  $('sync-status').textContent = session.meta.syncState === 'estimated'
    ? 'Sincronización automática por tramos de OBS; precisión estimada, pendiente de calibrar con una captura real.'
    : session.meta.syncState === 'recovered' ? 'Sincronización recuperada del registro real de OBS; alineación estimada.'
    : session.meta.syncState === 'error' ? 'Hubo un error de OBS. Revisa la grabación; la sincronización puede estar incompleta.' : 'Sin referencias automáticas de OBS.';
  if (videoOnly()) $('sync-status').textContent = 'El video está disponible, pero no tiene referencias de sincronización. Puedes reproducirlo por separado; las gráficas no moverán el video.';
  renderVideoControls(); seek(0);
  await list();
}

$('refresh').onclick = action(async () => { if (session) await load(session.meta.id); else await list(); });
$('auto').onchange = action(async () => { await api('auto', {enabled: $('auto').checked}); });
$('record').onclick = action(async () => { await api('start', {name: $('name').value}); await list(); });
$('stop').onclick = action(async () => {
  const id = latest?.recording;
  await api('stop', {});
  $('message').textContent = 'Sesión finalizada. Puedes abrirla para analizarla.';
  if (id) await load(id); else await list();
});
$('open-active').onclick = action(() => latest?.recording && load(latest.recording));
$('obs-connect').onclick = action(async () => {
  $('message').textContent = 'Conectando con OBS…';
  try {
    await api('obs', {port: Number($('obs-port').value), password: $('obs-password').value});
    $('message').textContent = 'OBS conectado. La próxima carrera iniciará la grabación.';
  } finally { $('obs-password').value = ''; }
});
$('obs-disable').onclick = action(async () => { await api('obs-disable', {}); $('message').textContent = 'Modo sólo telemetría.'; });
$('file').onchange = () => {
  const file = $('file').files[0];
  if (!file) return;
  setPlaying(false); clearVideo();
  objectUrl = URL.createObjectURL(file); hasVideo = true; $('video').src = objectUrl;
  $('video-status').textContent = 'Archivo local: ' + file.name;
  // A manually imported video without OBS references uses the legacy offset mapping.
  if (session && !session.meta.syncSegments?.length) session.meta.version = 1;
};
$('video').onloadedmetadata = () => {
  $('video-empty').hidden = true;
  if (videoOnly()) { $('time').max = $('video').duration; $('duration').textContent = $('video').duration.toFixed(2) + ' s'; }
  renderVideoControls(); seek(t);
};
$('video').onerror = () => {
  setPlaying(false);
  $('video-status').textContent = 'No se pudo abrir el video. Comprueba que existe y que usa un codec compatible (por ejemplo, MP4 H.264).';
};
$('skip-back').onclick = () => seek(t - 5);
$('skip-forward').onclick = () => seek(t + 5);
$('mute').onclick = () => {
  $('video').muted = !$('video').muted;
  updateVolume();
};
$('volume').oninput = () => { $('video').volume = Number($('volume').value); $('video').muted = $('video').volume === 0; updateVolume(); };
function updateVolume() {
  $('mute').setAttribute('aria-pressed', String($('video').muted));
  $('mute').setAttribute('aria-label', $('video').muted ? 'Activar sonido del video' : 'Silenciar video');
  $('mute').textContent = $('video').muted ? '♪̸' : '♪';
}
$('show-live').onclick = openLiveView;

function currentMeta() { return {...session?.meta, offset: Number($('offset').value) || 0}; }
function videoOnly() { return allMode && hasVideo && session?.meta.version === 2 && !session.meta.syncSegments?.length; }
function toVideo(time) { return session ? RaceTimeline.toVideo(currentMeta(), time) : null; }
function setVideoTime(value) {
  if (!Number.isFinite(value) || !Number.isFinite($('video').duration)) return;
  pendingSeek = Math.max(0, Math.min($('video').duration, value));
  $('video').currentTime = pendingSeek;
}
function seek(value) {
  if(videoOnly()){
    t=Math.max(0,Math.min(Number.isFinite($('video').duration)?$('video').duration:0,value));
    setVideoTime(t);$('time').value=t;draw();return;
  }
  const bounds=playbackBounds();
  t=Math.max(bounds.start,Math.min(bounds.end,value));
  refreshTransport();syncVideoPanes(true);draw();
}
function setPlaying(value) {
  playing = value;
  $('play').textContent = playing ? 'Ⅱ Pausar' : '▶ Reproducir';
  if (!value) { $('video').pause(); $('compare-video').pause(); }
}
$('time').oninput = () => seek(playbackBounds().start+Number($('time').value));
$('offset').onchange = () => seek(t);
$('align').onclick = () => {
  if (!hasVideo || !session) return;
  if(!allMode){$('message').textContent='Ajusta la sincronización desde Todo el recorrido.';return;}
  const mapped = toVideo(t);
  if (mapped === null) { $('message').textContent = 'Este punto no tiene referencia de video.'; return; }
  $('offset').value = ((Number($('offset').value) || 0) + $('video').currentTime - mapped).toFixed(3);
  draw();
};
$('save').onclick = action(async () => {
  if (!session) throw Error('Selecciona una sesión');
  await api('sync/' + session.meta.id, {offset: Number($('offset').value) || 0});
  $('message').textContent = 'Corrección guardada.';
});
$('play').onclick = () => {
  if (!session) return;
  const bounds=playbackBounds();
  if(t>=bounds.end)seek(bounds.start);
  setPlaying(!playing);
  syncVideoPanes(true);
};
$('rate').onchange = () => { $('video').playbackRate = Number($('rate').value); };
function canvas(id) {
  const element = $(id), rect = element.getBoundingClientRect(), ratio = devicePixelRatio || 1;
  if (element.width !== Math.round(rect.width * ratio) || element.height !== Math.round(rect.height * ratio)) {
    element.width = Math.round(rect.width * ratio); element.height = Math.round(rect.height * ratio);
  }
  const context = element.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, rect.width, rect.height);
  return [context, rect.width, rect.height];
}
function visible() { return session ? session.laps.filter(lap => selected.has(lap.id)) : []; }
function nearest(rows, key, value) {
  if (!rows.length) return null;
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid][key] < value) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(rows[lo-1][key] - value) < Math.abs(rows[lo][key] - value)) return rows[lo-1];
  return rows[lo];
}
function draw() {
  if(!session){drawInstruments(RaceConnection.connection(latest,Date.now()/1000,streamConnected).active?latest.packet:null);return;}
  const laps=session?analysisSeries():[], rows=laps.flatMap(lap=>lap.rows);
  const sample=observedSample();
  if (playing && sample && chartRange) {
    const full=analysisExtent();
    const next=RaceView.followRange(chartRange,[0,full],analysisX(sample));
    if (Math.abs(next.start-chartRange.start)>.001) { chartRange=next; scaleCache.clear(); }
  }
  $('clock').textContent = RaceAnalysis.clock(t-playbackBounds().start);
  $('metrics').textContent = sample ? `${sample.speed.toFixed(0)} km/h · ${sample.d.toFixed(0)} m` : '';
  updateTelemetryContext();
  const nextLegend=(allMode?'all:':'laps:')+laps.map(lap=>lap.id).join(',');
  if (legendKey !== nextLegend) {
    legendKey = nextLegend; $('lap-legend').replaceChildren();
    for (const lap of laps) { const label = document.createElement('span'), dot = document.createElement('i'); dot.style.background = colors[lap.id % colors.length]; label.append(dot, allMode?'Todo el recorrido':lapLabel(lap)); $('lap-legend').append(label); }
  }
  const [map, w, h] = canvas('map');
  if (rows.length) {
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (const row of rows) { xmin = Math.min(xmin, row.x); xmax = Math.max(xmax, row.x); zmin = Math.min(zmin, row.z); zmax = Math.max(zmax, row.z); }
    const scale = Math.min((w-30)/(xmax-xmin || 1), (h-30)/(zmax-zmin || 1)) * zoom;
    const point = row => [w/2 + (row.x-(xmin+xmax)/2)*scale + pan[0], h/2 - (row.z-(zmin+zmax)/2)*scale + pan[1]];
    for (const lap of laps) {
      map.strokeStyle = colors[lap.id % colors.length]; map.lineWidth = 2; map.beginPath();
      lap.rows.forEach((row, i) => { i === 0 || row.gap ? map.moveTo(...point(row)) : map.lineTo(...point(row)); });
      map.stroke();
      const row=sample?(allMode?nearest(lap.rows,'t',t):nearest(lap.rows,'d',sample.d)):null;
      if (row && sample.d <= lap.rows.at(-1).d) { map.fillStyle = map.strokeStyle; map.beginPath(); map.arc(...point(row), 5, 0, Math.PI*2); map.fill(); }
    }
  } else {
    map.fillStyle = '#8997aa'; map.font = '12px Segoe UI'; map.fillText('Abre una sesión para ver su recorrido.', 20, h/2);
  }
  drawMetrics(sample, laps);
  const liveRecent = RaceConnection.connection(latest,Date.now()/1000,streamConnected).active;
  drawInstruments(session ? sample : liveRecent && latest?.packet?.active ? latest.packet : null);
  if (session && hasVideo && !videoOnly() && toVideo(t) === null) $('clock').textContent += ' · sin video';
}
function drawInstruments(sample) {
  const rpm = sample?.rpm, gear = sample?.gear;
  const {ratio,maximum,engine} = RaceInstruments.rpmReference(sample,session?sessionRpmPeak:liveRpmPeak);
  $('instant-gear').textContent = Number.isFinite(gear) ? gear===0?'R':String(gear) : '—';
  $('instant-rpm').textContent = Number.isFinite(rpm) ? Math.round(rpm).toLocaleString('es-MX') : '—';
  $('instant-speed').textContent = Number.isFinite(sample?.speed) ? sample.speed.toFixed(0) : '—';
  $('rpm-fill').style.transform = `scaleX(${ratio ?? 0})`;
  $('rpm-scale').textContent = ratio === null ? 'Sin datos del motor' : `${engine?'Máximo del motor':'Pico medido · referencia visual'} · ${Math.round(maximum).toLocaleString('es-MX')} RPM`;
  $('rev-lights').classList.toggle('no-reading',ratio===null);
  const lights=RaceInstruments.revLights(ratio,gear,sample?.speed);
  $('rev-lights').classList.toggle('shift-alert',lights.shift);
  $('rev-lights').setAttribute('title',lights.shift?'Subir marcha · aviso estimado al 95% de la referencia de RPM':'Luces de RPM: de las orillas al centro');
  [...$('rev-lights').children].forEach((led,index)=>led.classList.toggle('lit',lights.lit[index]));
  $('instant-gear').dataset.highRpm = engine && ratio !== null && ratio>.95 ? 'true' : 'false';
  const measured = RaceInstruments.values(sample);
  $('instant-source').textContent = session ? 'Sesión · ' + t.toFixed(2) + ' s' : sample ? 'LIVE' : 'En espera';
  const missing = measured.steer === null || measured.lateral === null || measured.longitudinal === null || measured.tires.some(tire => tire.temp === null || tire.slip === null);
  $('instant-note').textContent = missing ? session ? 'Estos datos no se guardaban en sesiones anteriores.' : 'Esperando datos de conducción' : 'Valores del instante observado';
  $('steering-icon').classList.toggle('no-reading', measured.steer === null);
  $('steering-wheel').style.transform = `rotate(${(measured.steer ?? 0)*135}deg)`;
  $('steering-value').textContent = measured.steer === null ? 'Sin datos' : Math.abs(measured.steer)<.01 ? 'Centrado · 0%' : `${measured.steer<0?'Izq.':'Der.'} · ${Math.round(Math.abs(measured.steer)*100)}%`;
  $('steering-icon').setAttribute('aria-label', 'Entrada de dirección: ' + $('steering-value').textContent + '. El giro del icono es ilustrativo.');
  for (const key of ['throttle','brake']) {
    const value = sample?.[key];
    $('instant-'+key).style.transform = `scaleX(${Number.isFinite(value)?Math.max(0,Math.min(1,value/100)):0})`;
    $('instant-'+key+'-value').textContent = Number.isFinite(value) ? value.toFixed(0)+'%' : '—';
  }
  $('g-lateral').textContent = measured.lateral === null ? '—' : measured.lateral.toFixed(2)+' G';
  $('g-longitudinal').textContent = measured.longitudinal === null ? '—' : measured.longitudinal.toFixed(2)+' G';
  $('g-total').textContent = measured.total === null ? 'Sin datos' : measured.total.toFixed(2)+' G';
  $('g-point').style.opacity = measured.total === null ? 0 : 1;
  const size = Math.max(2, measured.total || 0);
  $('g-point').style.transform = `translate(${(measured.lateral || 0)/size*55}px,${-(measured.longitudinal || 0)/size*55}px)`;
  for (const [index, tire] of measured.tires.entries()) {
    const hue = tire.temp === null ? 210 : Math.max(0,Math.min(210,210-(tire.temp-40)/100*210));
    $('tire-'+index).style.setProperty('--tire-color', tire.temp === null ? '#526174' : `hsl(${hue} 75% 65%)`);
    $('tire-'+index).dataset.slipping = tire.slip !== null && tire.slip>1 ? 'true' : 'false';
    $('tire-temp-'+index).textContent = tire.temp === null ? '—' : tire.temp.toFixed(0)+'°C';
    $('tire-slip-'+index).textContent = tire.slip === null ? 'Sin datos de slip' : `Slip ${tire.slip.toFixed(2)}${tire.slip>1?' · exceso':''}`;
    $('tire-slip-bar-'+index).style.transform = `scaleX(${tire.slip === null?0:Math.min(1,tire.slip/2)})`;
  }
}
function updateTelemetryContext() {
  $('telemetry-scroll').setAttribute('aria-label',session ? allMode?'Gráficas por tiempo del instante observado':'Gráficas por distancia del instante observado' : 'Gráficas en vivo de los últimos veinte segundos');
}
function metricScale(metric, series) {
  const cacheKey = metric.key + ':' + series.map(item => item.id).join(',');
  if (session && scaleCache.has(cacheKey)) return scaleCache.get(cacheKey);
  let min = 0, max = metric.max || 1;
  if (!metric.max) for (const item of series) for (const row of item.rows) if (Number.isFinite(row[metric.key]) && (!session || !chartRange || analysisX(row)>=chartRange.start && analysisX(row)<=chartRange.end)) {
    min = Math.min(min, row[metric.key]); max = Math.max(max, row[metric.key]);
  }
  const bounds = [min, max];
  if (session) scaleCache.set(cacheKey, bounds);
  return bounds;
}
function drawMetrics(sample, laps) {
  const series = session ? analysisSeries() : [{id:0, rows:liveHistory}];
  const observed = session ? sample : latest?.packet ? {...latest.packet, d:latest.packet.distance} : null;
  const maxDistance=analysisExtent();
  const range = chartRange || {start:0,end:maxDistance};
  const span = Math.max(.001,range.end-range.start);
  $('chart-zoom-label').textContent = (session ? maxDistance/span : 20/liveChartSpan).toFixed(1).replace('.0','')+'×';
  const full = session ? maxDistance : 20, shown = session ? span : liveChartSpan;
  const available = Math.max(0,full-shown);
  const start = session ? range.start : available-liveChartOffset;
  $('chart-pan').disabled = available < .001;
  $('chart-pan').value = available > .001 ? Math.round(Math.max(0,Math.min(1,start/available))*1000) : 0;
  $('chart-pan').style.setProperty('--window-width',Math.min(100,shown/full*100)+'%');
  const rangeLabel = session ? allMode?`Tramo visible: ${RaceAnalysis.clock(range.start)} a ${RaceAnalysis.clock(range.end)}`:`Tramo visible: ${range.start.toFixed(0)} a ${range.end.toFixed(0)} metros` : `Tramo visible: hace ${(liveChartOffset+liveChartSpan).toFixed(1)} a ${liveChartOffset.toFixed(1)} segundos`;
  $('chart-pan').setAttribute('aria-valuetext',rangeLabel);
  $('chart-pan').title = available < .001 ? 'Acerca las gráficas para desplazarlas' : rangeLabel;
  const scrollRect = $('telemetry-scroll').getBoundingClientRect();
  $('telemetry-rows').style.setProperty('--metric-height',Math.max(1,scrollRect.height/3)+'px');
  for (const [index, metric] of metricDefs.entries()) {
    const value = observed?.[metric.key];
    const duration = metric.divisor ? RaceInstruments.duration(value) : null;
    $('value-' + metric.key).textContent = duration ? duration.text : Number.isFinite(value) ? value.toFixed(metric.decimals) : '—';
    if (duration) $('value-' + metric.key).nextElementSibling.textContent=duration.unit;
    const id = index === 0 ? 'charts' : 'chart-' + metric.key, element = $(id), rect = element.getBoundingClientRect();
    element.classList.toggle('live-chart', !session);
    element.setAttribute('aria-label', metric.name + (session ? allMode?' por tiempo':' por distancia' : ' en vivo'));
    if (rect.bottom < scrollRect.top || rect.top > scrollRect.bottom) continue;
    const [chart, width, height] = canvas(id), [min, max] = metricScale(metric, series);
    const left = metric.divisor?58:28, right = width - 8, top = 6, bottom = height - 19;
    const end = (liveHistory.at(-1)?.liveTime || 0)-liveChartOffset;
    const point = row => [session ? left + (analysisX(row)-range.start)/span*(right-left) : left + (row.liveTime - (end-liveChartSpan))/liveChartSpan*(right-left), bottom - (row[metric.key]-min)/(max-min || 1)*(bottom-top)];
    const axisValue=value=>{if(!metric.divisor)return value.toFixed(0);const d=RaceInstruments.duration(value);return d.text+' '+d.unit;};
    chart.font = '9px Segoe UI'; chart.fillStyle = '#7489a2'; chart.fillText(axisValue(max), 0, top+6); chart.fillText(axisValue(min), 0, bottom);
    chart.strokeStyle = '#26354a'; chart.lineWidth = 1; chart.beginPath(); chart.moveTo(left, bottom); chart.lineTo(right, bottom); chart.stroke();
    chart.save(); chart.beginPath(); chart.rect(left,top,right-left,bottom-top); chart.clip();
    for (const item of series) {
      chart.strokeStyle = session ? colors[item.id % colors.length] : colors[0]; chart.lineWidth = 1.4; chart.beginPath();
      let previous = null;
      for (const row of item.rows) {
        if (!Number.isFinite(row[metric.key])) { previous = null; continue; }
        const p = point(row);
        if (!previous || row.gap || row.breakBefore) chart.moveTo(...p);
        else { if (metric.step) chart.lineTo(p[0], previous[1]); chart.lineTo(...p); }
        previous = p;
      }
      chart.stroke();
    }
    if (sample) { const x = left + (analysisX(sample)-range.start)/span*(right-left); chart.strokeStyle = '#e3fff0aa'; chart.beginPath(); chart.moveTo(x, top); chart.lineTo(x, bottom); chart.stroke(); }
    chart.restore();
    chart.fillStyle = '#7489a2'; chart.fillText(session ? allMode?RaceAnalysis.clock(range.start):range.start.toFixed(0)+' m' : '−'+(liveChartSpan+liveChartOffset).toFixed(1)+' s', left, height-3);
    chart.textAlign = 'right'; chart.fillText(session ? allMode?RaceAnalysis.clock(range.end):range.end.toFixed(0)+' m' : liveChartOffset<.01?'Ahora':'−'+liveChartOffset.toFixed(1)+' s', right, height-3); chart.textAlign = 'left';
  }
}
function chartSeek(event) {
  if (!session) return;
  const lap = session?.laps.find(item => item.id === reference);
  if (!allMode&&!lap?.rows.length) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const max=analysisExtent();
  const range = chartRange || {start:0,end:max};
  const left=['lapTime','raceTime'].includes(event.currentTarget.dataset.key)?58:28;
  const distance = range.start + Math.max(0, Math.min(1, (event.clientX-rect.left-left)/(rect.width-left-8))) * (range.end-range.start);
  if(allMode)seek(distance);else seek(nearest(lap.rows,'d',distance).t);
}
for (const element of $('telemetry-rows').querySelectorAll('canvas')) {
  element.onpointerdown = event => { if (!session) return; chartDragging = true; element.setPointerCapture(event.pointerId); chartSeek(event); };
  element.onpointermove = event => { if (chartDragging) chartSeek(event); };
  element.onpointerup = element.onpointercancel = () => { chartDragging = false; };
  element.addEventListener('wheel',event=>{
    if (!event.ctrlKey) return;
    event.preventDefault();
    const max=analysisExtent();
    const range=chartRange||{start:0,end:max}, rect=element.getBoundingClientRect();
    const left=['lapTime','raceTime'].includes(element.dataset.key)?58:28;
    const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left-left)/(rect.width-left-8)));
    zoomCharts(Math.exp(-event.deltaY*.002),range.start+fraction*(range.end-range.start));
  },{passive:false});
}
function zoomCharts(factor,anchor) {
  if (!session) { liveChartSpan=Math.max(.5,Math.min(20,liveChartSpan/factor)); liveChartOffset=Math.min(liveChartOffset,20-liveChartSpan); }
  else {
    const max=analysisExtent();
    const sample=observedSample();
    const current=chartRange||{start:0,end:max};
    const target=anchor ?? (sample?analysisX(sample):null) ?? (current.start+current.end)/2;
    // Toolbar zoom recenters on the analysis cursor even if it left the previous window.
    const initial=anchor===undefined ? {start:Math.max(0,Math.min(max-(current.end-current.start),target-(current.end-current.start)/2)),end:0} : current;
    if (anchor===undefined) initial.end=initial.start+current.end-current.start;
    chartRange=RaceView.zoomRange(initial,[0,max],target,factor);
  }
  scaleCache.clear(); draw();
}
$('chart-zoom-in').onclick=()=>zoomCharts(2);
$('chart-zoom-out').onclick=()=>zoomCharts(.5);
$('chart-zoom-reset').onclick=()=>{chartRange=null;liveChartSpan=20;liveChartOffset=0;scaleCache.clear();draw();};
$('chart-pan').oninput=()=>{
  const fraction=Number($('chart-pan').value)/1000;
  if (session) {
    const full=analysisExtent();
    const span=chartRange?chartRange.end-chartRange.start:full;
    const start=fraction*Math.max(0,full-span);
    chartRange={start,end:start+span};
  } else liveChartOffset=(1-fraction)*(20-liveChartSpan);
  scaleCache.clear(); draw();
};
$('telemetry-scroll').onscroll = () => requestAnimationFrame(draw);
$('map').addEventListener('wheel',event=>{
  event.preventDefault();
  const next=Math.max(.2,Math.min(30,zoom*Math.exp(-event.deltaY*.001)));
  const rect=$('map').getBoundingClientRect();
  pan=RaceView.anchoredPan(pan,[event.clientX-rect.left,event.clientY-rect.top],[rect.width/2,rect.height/2],next/zoom);
  zoom=next; draw();
},{passive:false});
$('map').onpointerdown = event => { drag = [event.clientX, event.clientY]; $('map').setPointerCapture(event.pointerId); };
$('map').onpointermove = event => { if (drag) { pan[0] += event.clientX-drag[0]; pan[1] += event.clientY-drag[1]; drag = [event.clientX, event.clientY]; draw(); } };
$('map').onpointerup = $('map').onpointercancel = () => { drag = null; };
$('fit').onclick = () => { zoom = 1; pan = [0, 0]; draw(); };
window.onresize = draw;

function frame(now) {
  if (playing && videoOnly()) {
    const video = $('video');
    if (Number.isFinite(video.duration)) {
      if (video.ended) setPlaying(false);
      else if (video.paused) video.play().catch(() => { setPlaying(false); $('message').textContent = 'Vuelve a pulsar Reproducir en la barra flotante.'; });
      t = video.currentTime; $('time').value = t;
      $('clock').textContent = video.currentTime.toFixed(2) + ' s · video sin sincronizar';
    }
  } else if (playing && session) {
    const bounds=playbackBounds(),dt=Math.min((now-last)/1000,.1);
    t=Math.min(bounds.end,t+dt*Number($('rate').value));
    syncVideoPanes(false,dt);refreshTransport();draw();
    if(t>=bounds.end)setPlaying(false);
  }
  last = now; requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function live(state) {
  latest = state;streamConnected=true;updateLiveView();
  const connected = state.lastPacket && Date.now()/1000-state.lastPacket < 2;
  $('status').textContent = state.udpError ? 'Error UDP: '+state.udpError : `UDP ${connected ? 'activo' : 'en espera'} · ${state.packets} paquetes · ${state.invalid} rechazados · ${state.dropped} perdidos en cola`;
  $('auto').checked = state.auto;
  $('capture-state').dataset.mode = state.mode;
  const labels = {armed: 'Listo para la próxima carrera', idle: 'Detección automática desactivada', recording: '● Grabando carrera', paused: 'Ⅱ Pausa / esperando confirmar el final'};
  $('capture-state').textContent = (labels[state.mode] || state.mode) + (state.recording ? ` · ${state.elapsed.toFixed(1)} s` : '');
  $('open-active').hidden = !state.recording;
  $('obs-status').textContent = state.obs.error || (state.obs.connected ? `OBS conectado${state.obs.owned ? ' · grabación de RaceLab' : ' · listo'}` : state.obs.enabled ? 'OBS desconectado · revisa la conexión' : 'Sin conectar · sólo telemetría');
  if (state.error) $('message').textContent = state.error;
  const packet = state.packet;
  if(packet?.active && Number.isFinite(packet.rpm)) {
    if(packet.carOrdinal!==liveRpmCar){liveRpmCar=packet.carOrdinal;liveRpmPeak=0;}
    liveRpmPeak=Math.max(liveRpmPeak,packet.rpm);
  }
  if (packet && packet.timestamp !== lastLiveStamp) {
    lastLiveStamp = packet.timestamp;
    const now = performance.now()/1000;
    liveHistory.push({...packet, d:packet.distance, liveTime:now});
    liveHistory = liveHistory.filter(row => now-row.liveTime <= 20);
  }
  if (!session) draw();
  if (revision !== state.revision) {
    const changed = revision !== null; revision = state.revision;
    list().catch(() => {});
    if (session && changed && state.lastSaved && !state.recording && !playing) load(state.lastSaved).catch(e => { $('message').textContent = e.message; });
  }
}
const events = new EventSource('/events');
events.onmessage = event => { try { live(JSON.parse(event.data)); } catch (e) { $('message').textContent = 'Error de actualización: '+e.message; } };
events.onerror = () => { streamConnected=false;updateLiveView();if(!session)draw();$('status').textContent = 'Servidor desconectado · reconectando…'; };
list().catch(e => { $('message').textContent = e.message; });
const resizeObserver = new ResizeObserver(() => requestAnimationFrame(draw));
setupAnalysisUI();setupViewUI();
const initialSession=/^#session\/([a-zA-Z0-9]+)$/.exec(location.hash)?.[1];
if(initialSession)load(initialSession).catch(e=>{openLiveView();$('message').textContent=e.message;});
else openLiveView();
resizeObserver.observe($('map')); resizeObserver.observe($('telemetry-scroll'));
draw();
