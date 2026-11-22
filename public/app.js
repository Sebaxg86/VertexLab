const $ = id => document.getElementById(id);
const colors = ['#59e2ba', '#bc91ff', '#ffb65b', '#69baff', '#ff7295'];
let session = null, selected = new Set(), reference = null, t = 0, playing = false;
let last = 0, zoom = 1, pan = [0, 0], drag = null, objectUrl = null, hasVideo = false;
let latest = null, revision = null, pendingSeek = null, chartDragging = false;

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
    button.onclick = action(() => load(item.id));
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
}
async function load(id) {
  setPlaying(false);
  clearVideo();
  session = await api('sessions/' + id);
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
  t = 0; zoom = 1; pan = [0, 0];
  if (session.meta.videoPath) {
    hasVideo = true;
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
$('video').onloadedmetadata = () => seek(t);
$('video').onerror = () => {
  setPlaying(false);
  $('video-status').textContent = 'No se pudo abrir el video. Comprueba que existe y que usa un codec compatible (por ejemplo, MP4 H.264).';
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
  const videoTime = toVideo(t);
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
    map.fillStyle = '#8997aa'; map.font = '14px Segoe UI'; map.fillText('Selecciona una sesión con muestras.', 20, h/2);
  }
  const [chart, cw, ch] = canvas('charts');
  const maxDistance = Math.max(1, ...laps.map(lap => lap.rows.at(-1)?.d || 0));
  const speedMax = Math.max(100, ...laps.map(lap => lap.rows.reduce((max, row) => Math.max(max, row.speed), 0)));
  ['speed', 'throttle', 'brake'].forEach((key, index) => {
    const top = index*105+22, bottom = top+70, max = index === 0 ? speedMax : 100;
    chart.fillStyle = '#91a3bb'; chart.font = '11px Segoe UI';
    chart.fillText(['Velocidad km/h', 'Acelerador %', 'Freno %'][index], 8, top-8);
    chart.strokeStyle = '#29364b'; chart.beginPath(); chart.moveTo(45, bottom); chart.lineTo(cw-15, bottom); chart.stroke();
    for (const lap of laps) {
      chart.strokeStyle = colors[lap.id % colors.length]; chart.beginPath();
      lap.rows.forEach((row, i) => { const x = 45+row.d/maxDistance*(cw-60), y = bottom-row[key]/max*65; i === 0 || row.gap ? chart.moveTo(x, y) : chart.lineTo(x, y); });
      chart.stroke();
    }
    if (sample) { const x = 45+sample.d/maxDistance*(cw-60); chart.strokeStyle = '#ffffff99'; chart.beginPath(); chart.moveTo(x, top); chart.lineTo(x, bottom); chart.stroke(); }
  });
  chart.fillStyle = '#91a3bb'; chart.fillText(`0 m → ${maxDistance.toFixed(0)} m`, cw-140, ch-2);
  if (session && hasVideo && toVideo(t) === null) $('clock').textContent += ' · sin video en este tramo';
}
function chartSeek(event) {
  const lap = session?.laps.find(item => item.id === reference);
  if (!lap?.rows.length) return;
  const rect = $('charts').getBoundingClientRect();
  const max = Math.max(1, ...visible().map(item => item.rows.at(-1)?.d || 0));
  const distance = Math.max(0, Math.min(1, (event.clientX-rect.left-45)/(rect.width-60))) * max;
  seek(nearest(lap.rows, 'd', distance).t);
}
$('charts').onpointerdown = event => { chartDragging = true; $('charts').setPointerCapture(event.pointerId); chartSeek(event); };
$('charts').onpointermove = event => { if (chartDragging) chartSeek(event); };
$('charts').onpointerup = $('charts').onpointercancel = () => { chartDragging = false; };
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
      else if (video.paused) video.play().catch(() => { setPlaying(false); $('message').textContent = 'Pulsa reproducir directamente en el video.'; });
      $('clock').textContent = video.currentTime.toFixed(2) + ' s · video sin sincronizar';
    }
  } else if (playing && session) {
    t = Math.min(Number($('time').max), t + Math.min((now-last)/1000, .1)*Number($('rate').value));
    const videoTime = toVideo(t), video = $('video');
    if (hasVideo && videoTime !== null && Number.isFinite(video.duration)) {
      if (Math.abs(video.currentTime-videoTime) > .15) setVideoTime(videoTime);
      video.playbackRate = Number($('rate').value);
      if (video.paused && !video.ended) video.play().catch(() => { setPlaying(false); $('message').textContent = 'Pulsa reproducir en el video para permitir su reproducción.'; });
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
  $('live-state').textContent = connected ? packet?.active ? 'LIVE' : 'Juego inactivo' : 'Sin señal reciente';
  if (packet) {
    $('live-car').textContent = `${state.carName || 'Vehículo #'+packet.carOrdinal} · clase ${packet.carClass} · PI ${packet.carPI}`;
    $('live-speed').textContent = packet.speed.toFixed(0); $('live-rpm').textContent = packet.rpm.toFixed(0);
    $('live-gear').textContent = packet.gear === 0 ? 'R' : packet.gear;
    $('live-throttle').value = packet.throttle; $('live-brake').value = packet.brake;
    $('throttle-value').textContent = packet.throttle.toFixed(0)+'%'; $('brake-value').textContent = packet.brake.toFixed(0)+'%';
  }
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
draw();
