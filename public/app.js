const $ = id => document.getElementById(id);
const colors = ['#59e2ba', '#bc91ff', '#ffb65b', '#69baff', '#ff7295'];
let session = null, selected = new Set(), reference = null, t = 0, playing = false;
let last = 0, zoom = 1, pan = [0, 0], drag = null, objectUrl = null, hasVideo = false;
let latest = null, revision = null, pendingSeek = null, chartDragging = false;
let liveHistory = [], lastLiveStamp = null, legendKey = null, toastTimer;
const scaleCache = new Map();
const metricDefs = [
  {key:'speed', name:'Velocidad', unit:'km/h', decimals:0},
  {key:'rpm', name:'Revoluciones', unit:'RPM', decimals:0},
  {key:'throttle', name:'Acelerador', unit:'%', decimals:0, max:100},
  {key:'brake', name:'Freno', unit:'%', decimals:0, max:100},
  {key:'gear', name:'Marcha', unit:'', decimals:0, step:true},
  {key:'racePosition', name:'Posición en carrera', unit:'', decimals:0, step:true},
  {key:'lapTime', name:'Tiempo de vuelta', unit:'s', decimals:2},
  {key:'raceTime', name:'Tiempo de carrera', unit:'s', decimals:2},
  {key:'d', name:'Distancia', unit:'m', decimals:0},
  {key:'x', name:'Posición X', unit:'m', decimals:1},
  {key:'y', name:'Altura', unit:'m', decimals:1},
  {key:'z', name:'Posición Z', unit:'m', decimals:1}
];
for (const [index, metric] of metricDefs.entries()) {
  const card = document.createElement('article');
  card.className = 'metric-card';
  card.innerHTML = `<div class="metric-heading"><h3 class="metric-name">${metric.name}</h3><div class="metric-number"><output id="value-${metric.key}">—</output><span class="metric-unit">${metric.unit}</span></div></div><canvas id="${index === 0 ? 'charts' : 'chart-' + metric.key}" aria-label="${metric.name} por distancia" data-key="${metric.key}"></canvas>`;
  $('telemetry-rows').append(card);
}

function setMenu(open) {
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
  $('video').pause();
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
  scaleCache.clear(); legendKey = null; $('telemetry-scroll').scrollTop = 0;
  selected = new Set(session.laps.map(lap => lap.id));
  reference = session.laps[0]?.id ?? null;
  $('title').textContent = session.meta.name;
  $('offset').value = session.meta.offset || 0;
  $('session-info').textContent = `Clase ${session.meta.carClass ?? '—'} · PI ${session.meta.carPI ?? '—'} · ${session.laps.reduce((n, l) => n + l.rows.length, 0)} muestras${session.meta.ended ? '' : ' · Usa Actualizar para recargar una sesión abierta'}`;
  $('laps').replaceChildren();
  $('reference').replaceChildren();
  for (const lap of session.laps) {
    const label = document.createElement('label'), box = document.createElement('input');
    box.type = 'checkbox'; box.checked = true;
    box.onchange = () => {
      box.checked ? selected.add(lap.id) : selected.delete(lap.id);
      if (!selected.has(reference)) reference = visible()[0]?.id ?? null;
      $('reference').value = String(reference);
      draw();
    };
    label.style.color = colors[lap.id % colors.length];
    label.append(box, ` Vuelta ${lap.number} · ${lap.partial ? 'parcial / con cortes' : 'completa'}`);
    $('laps').append(label);
    const option = document.createElement('option');
    option.value = lap.id; option.textContent = `Vuelta ${lap.number}`;
    $('reference').append(option);
  }
  $('reference').value = String(reference);
  $('time').max = Math.max(0, ...session.laps.map(lap => lap.rows.at(-1)?.t || 0));
  $('duration').textContent = Number($('time').max).toFixed(2) + ' s';
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
  seek(0);
  await list();
}

$('refresh').onclick = action(async () => { if (session) await load(session.meta.id); else await list(); });
$('reference').onchange = () => {
  reference = Number($('reference').value);
  if (!selected.has(reference)) {
    selected.add(reference);
    $('laps').querySelectorAll('input')[reference].checked = true;
  }
  draw();
};
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
  seek(t);
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
$('show-live').onclick = () => {
  setPlaying(false); clearVideo(); session = null; selected.clear(); reference = null;
  $('title').textContent = 'Telemetría en vivo'; $('session-info').textContent = 'Los valores corresponden a los paquetes actuales del juego.';
  $('time').max = 0; $('time').value = 0; t = 0; $('duration').textContent = '0.00 s';
  $('show-live').hidden = true; $('reference').replaceChildren(); $('laps').textContent = 'Selecciona una sesión.';
  $('sync-status').textContent = ''; $('video-status').textContent = 'Abre una sesión desde el menú para analizar su video.';
  scaleCache.clear(); legendKey = null; draw();
};

function currentMeta() { return {...session?.meta, offset: Number($('offset').value) || 0}; }
function videoOnly() { return hasVideo && session?.meta.version === 2 && !session.meta.syncSegments?.length; }
function toVideo(time) { return session ? RaceTimeline.toVideo(currentMeta(), time) : null; }
function setVideoTime(value) {
  if (!Number.isFinite(value) || !Number.isFinite($('video').duration)) return;
  pendingSeek = Math.max(0, Math.min($('video').duration, value));
  $('video').currentTime = pendingSeek;
}
function seek(value) {
  t = Math.max(0, Math.min(Number($('time').max), value));
  $('time').value = t;
  const videoTime = videoOnly() ? t : toVideo(t);
  if (hasVideo && videoTime !== null) setVideoTime(videoTime);
  draw();
}
function setPlaying(value) {
  playing = value;
  $('play').textContent = playing ? 'Ⅱ Pausar' : '▶ Reproducir';
  if (!value) $('video').pause();
}
$('time').oninput = () => seek(Number($('time').value));
$('offset').onchange = () => seek(t);
$('align').onclick = () => {
  if (!hasVideo || !session) return;
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
  if (t >= Number($('time').max)) seek(0);
  setPlaying(!playing);
  if (playing && hasVideo && Number.isFinite($('video').duration)) {
    $('video').play().catch(() => { setPlaying(false); $('message').textContent = 'No se pudo reproducir el video. Vuelve a pulsar Reproducir en la barra.'; });
  }
};
$('rate').onchange = () => { $('video').playbackRate = Number($('rate').value); };
$('video').addEventListener('seeking', () => {
  if (pendingSeek !== null && Math.abs($('video').currentTime - pendingSeek) < .05) { pendingSeek = null; return; }
  pendingSeek = null;
  if (!session) return;
  const value = RaceTimeline.fromVideo(currentMeta(), $('video').currentTime);
  if (value !== null) { t = Math.max(0, Math.min(Number($('time').max), value)); $('time').value = t; draw(); }
});
$('video').addEventListener('play', () => { if (session) setPlaying(true); });
$('video').addEventListener('pause', () => {
  // Internal pauses cover missing footage; native controls otherwise pause everything.
  if ((toVideo(t) !== null || videoOnly()) && !$('video').ended) { playing = false; $('play').textContent = '▶ Reproducir'; }
});
$('video').addEventListener('ended', () => setPlaying(false));

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
  const laps = visible(), rows = laps.flatMap(lap => lap.rows);
  const current = session?.laps.find(lap => lap.rows.length && t >= lap.rows[0].t && t <= lap.rows.at(-1).t);
  const sample = current ? nearest(current.rows, 't', t) : null;
  $('clock').textContent = t.toFixed(2) + ' s';
  $('metrics').textContent = sample ? `${sample.speed.toFixed(0)} km/h · ${sample.d.toFixed(0)} m` : '';
  updateTelemetryContext();
  const nextLegend = laps.map(lap => lap.id).join(',');
  if (legendKey !== nextLegend) {
    legendKey = nextLegend; $('lap-legend').replaceChildren();
    for (const lap of laps) { const label = document.createElement('span'), dot = document.createElement('i'); dot.style.background = colors[lap.id % colors.length]; label.append(dot, `Vuelta ${lap.number}`); $('lap-legend').append(label); }
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
      const row = sample ? nearest(lap.rows, 'd', sample.d) : null;
      if (row && sample.d <= lap.rows.at(-1).d) { map.fillStyle = map.strokeStyle; map.beginPath(); map.arc(...point(row), 5, 0, Math.PI*2); map.fill(); }
    }
  } else {
    map.fillStyle = '#8997aa'; map.font = '12px Segoe UI'; map.fillText('Abre una sesión para ver su recorrido.', 20, h/2);
  }
  drawMetrics(sample, laps);
  if (session && hasVideo && !videoOnly() && toVideo(t) === null) $('clock').textContent += ' · sin video';
}
function updateTelemetryContext() {
  const connected = latest?.lastPacket && Date.now()/1000 - latest.lastPacket < 2;
  $('live-state').textContent = session ? 'SESIÓN' : connected && latest.packet?.active ? 'LIVE' : 'EN ESPERA';
  $('live-car').textContent = session ? `${session.meta.name} · clase ${session.meta.carClass ?? '—'} · PI ${session.meta.carPI ?? '—'}`
    : latest?.packet ? `${latest.carName || 'Vehículo #' + latest.packet.carOrdinal} · clase ${latest.packet.carClass} · PI ${latest.packet.carPI}` : 'Esperando el vehículo';
  $('telemetry-axis').textContent = session ? 'Comparación por distancia · valores en el cursor' : 'Últimos 20 segundos · valores en vivo';
}
function metricScale(metric, series) {
  const cacheKey = metric.key + ':' + series.map(item => item.id).join(',');
  if (session && scaleCache.has(cacheKey)) return scaleCache.get(cacheKey);
  let min = 0, max = metric.max || 1;
  if (!metric.max) for (const item of series) for (const row of item.rows) if (Number.isFinite(row[metric.key])) {
    min = Math.min(min, row[metric.key]); max = Math.max(max, row[metric.key]);
  }
  const bounds = [min, max];
  if (session) scaleCache.set(cacheKey, bounds);
  return bounds;
}
function drawMetrics(sample, laps) {
  const series = session ? laps : [{id:0, rows:liveHistory}];
  const observed = session ? sample : latest?.packet ? {...latest.packet, d:latest.packet.distance} : null;
  const maxDistance = Math.max(1, ...laps.map(lap => lap.rows.at(-1)?.d || 0));
  const scrollRect = $('telemetry-scroll').getBoundingClientRect();
  for (const [index, metric] of metricDefs.entries()) {
    const value = observed?.[metric.key];
    $('value-' + metric.key).textContent = Number.isFinite(value) ? metric.key === 'gear' && value === 0 ? 'R' : value.toFixed(metric.decimals) : '—';
    const id = index === 0 ? 'charts' : 'chart-' + metric.key, element = $(id), rect = element.getBoundingClientRect();
    element.classList.toggle('live-chart', !session);
    element.setAttribute('aria-label', metric.name + (session ? ' por distancia' : ' en vivo'));
    if (rect.bottom < scrollRect.top || rect.top > scrollRect.bottom) continue;
    const [chart, width, height] = canvas(id), [min, max] = metricScale(metric, series);
    const left = 28, right = width - 8, top = 6, bottom = height - 19;
    const end = liveHistory.at(-1)?.liveTime || 0;
    const point = row => [session ? left + row.d/maxDistance*(right-left) : left + (row.liveTime - (end-20))/20*(right-left), bottom - (row[metric.key]-min)/(max-min || 1)*(bottom-top)];
    chart.font = '9px Segoe UI'; chart.fillStyle = '#7489a2'; chart.fillText(max.toFixed(0), 0, top+6); chart.fillText(min.toFixed(0), 0, bottom);
    chart.strokeStyle = '#26354a'; chart.lineWidth = 1; chart.beginPath(); chart.moveTo(left, bottom); chart.lineTo(right, bottom); chart.stroke();
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
    if (sample) { const x = left + sample.d/maxDistance*(right-left); chart.strokeStyle = '#e3fff0aa'; chart.beginPath(); chart.moveTo(x, top); chart.lineTo(x, bottom); chart.stroke(); }
    chart.fillStyle = '#7489a2'; chart.fillText(session ? '0 m' : '−20 s', left, height-3);
    chart.textAlign = 'right'; chart.fillText(session ? maxDistance.toFixed(0)+' m' : 'Ahora', right, height-3); chart.textAlign = 'left';
  }
}
function chartSeek(event) {
  if (!session) return;
  const lap = session?.laps.find(item => item.id === reference);
  if (!lap?.rows.length) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const max = Math.max(1, ...visible().map(item => item.rows.at(-1)?.d || 0));
  const distance = Math.max(0, Math.min(1, (event.clientX-rect.left-28)/(rect.width-36))) * max;
  seek(nearest(lap.rows, 'd', distance).t);
}
for (const element of $('telemetry-rows').querySelectorAll('canvas')) {
  element.onpointerdown = event => { if (!session) return; chartDragging = true; element.setPointerCapture(event.pointerId); chartSeek(event); };
  element.onpointermove = event => { if (chartDragging) chartSeek(event); };
  element.onpointerup = element.onpointercancel = () => { chartDragging = false; };
}
$('telemetry-scroll').onscroll = () => requestAnimationFrame(draw);
$('map').onwheel = event => { event.preventDefault(); zoom = Math.max(.2, Math.min(30, zoom*Math.exp(-event.deltaY*.001))); draw(); };
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
    t = Math.min(Number($('time').max), t + Math.min((now-last)/1000, .1)*Number($('rate').value));
    const videoTime = toVideo(t), video = $('video');
    if (hasVideo && videoTime !== null && Number.isFinite(video.duration)) {
      if (Math.abs(video.currentTime-videoTime) > .15) setVideoTime(videoTime);
      video.playbackRate = Number($('rate').value);
      if (video.paused && !video.ended) video.play().catch(() => { setPlaying(false); $('message').textContent = 'Vuelve a pulsar Reproducir en la barra flotante.'; });
    } else if (!video.paused) video.pause();
    $('time').value = t; draw();
    if (t >= Number($('time').max)) setPlaying(false);
  }
  last = now; requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function live(state) {
  latest = state;
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
    if (changed && state.lastSaved && !state.recording && !playing) load(state.lastSaved).catch(e => { $('message').textContent = e.message; });
  }
}
const events = new EventSource('/events');
events.onmessage = event => { try { live(JSON.parse(event.data)); } catch (e) { $('message').textContent = 'Error de actualización: '+e.message; } };
events.onerror = () => { $('status').textContent = 'Servidor desconectado · reconectando…'; };
list().catch(e => { $('message').textContent = e.message; });
const resizeObserver = new ResizeObserver(() => requestAnimationFrame(draw));
resizeObserver.observe($('map')); resizeObserver.observe($('telemetry-scroll'));
draw();
