const $ = id => document.getElementById(id);
VertexPlayback.observe($('video'));
const colors = ['#ff414c', '#b8c4d2', '#ffb65b', '#69baff', '#bc91ff'];
let session = null, selected = new Set(), reference = null, t = 0, playing = false;
let last = 0, zoom = 1, pan = [0, 0], drag = null, objectUrl = null, hasVideo = false;
let latest = null, revision = null, pendingSeek = null, chartDragging = false;
let liveHistory = [], lastLiveStamp = null, legendKey = null, toastTimer;
let chartRange = null, liveChartSpan = 20, liveChartOffset = 0;
let sessionRpmPeak = 0, liveRpmPeak = 0, liveRpmCar = null;
let shiftMemory = {key:null,active:false};
let revSweepState=null, gearDisplayState=null;
const revMotion=matchMedia('(prefers-reduced-motion: reduce)');
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
  tile.innerHTML = `<svg viewBox="0 0 36 64" aria-hidden="true" class="racing-tire"><rect x="3" y="2" width="30" height="60" rx="9" class="tire-body"/><path d="M8 7v50M28 7v50" class="tire-shoulder"/><path d="M14 4v56M22 4v56" class="tire-groove"/><path d="m4 12 9-5m-9 17 9-5m-9 17 9-5m-9 17 9-5m10-36 9 5m-9 7 9 5m-9 7 9 5m-9 7 9 5" class="tire-tread"/><path d="M16 12h4M16 22h4M16 32h4M16 42h4M16 52h4" class="tire-sipes"/></svg><div class="tire-info"><span>${tireLabels[index]}</span><output id="tire-temp-${index}">—</output><small id="tire-slip-${index}">Sin datos</small><div class="slip-meter"><i id="tire-slip-bar-${index}"></i><em></em></div></div>`;
  tile.querySelector('.tire-info>span').dataset.short=['DI','DD','TI','TD'][index];
  tile.querySelector('.tire-info>span').title=tireLabels[index];
  $('tire-grid').append(tile);
}
for (const [index, metric] of metricDefs.entries()) {
  const card = document.createElement('article');
  card.className = 'metric-card';
  card.innerHTML = `<div class="metric-heading"><h3 class="metric-name">${metric.name}</h3><div class="metric-number"><output id="value-${metric.key}">—</output><span class="metric-unit">${metric.unit}</span></div></div><canvas id="${index === 0 ? 'charts' : 'chart-' + metric.key}" aria-label="${metric.name} por tiempo" data-key="${metric.key}"></canvas>`;
  $('telemetry-rows').append(card);
}

let settingsMenuPlaceholder=null,settingsMenuTimer=null,settingsBackdropTimer=null;
function settingsBackdrop(){
  let el=$('analysis-menu-backdrop');
  if(!el){
    el=document.createElement('div');
    el.id='analysis-menu-backdrop';
    el.className='home-popover-backdrop';
    el.setAttribute('aria-hidden','true');
    el.hidden=true;
    el.addEventListener('pointerdown',event=>{event.stopPropagation();});
    el.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();setMenu(false);});
    document.body.append(el);
  }
  return el;
}
function setSettingsBackdrop(open){
  const el=$('analysis-menu-backdrop')||(open?settingsBackdrop():null);
  if(!el)return;
  clearTimeout(settingsBackdropTimer);
  if(open){
    el.hidden=false;
    requestAnimationFrame(()=>{if(!el.hidden)el.classList.add('is-open');});
  }else{
    el.classList.remove('is-open');
    settingsBackdropTimer=setTimeout(()=>{el.hidden=true;},200);
  }
}
function setMenu(open){
  const panel=$('settings-panel'),trigger=$('settings-toggle');
  if(open&&session)updateSessionActions();
  if(open){setSessionPicker(false);setHeaderDrop('record-name-menu','record-name-trigger',false);}
  clearTimeout(settingsMenuTimer);
  const mobileMenu=matchMedia('(max-width:600px)').matches;
  if(open&&session&&mobileMenu){
    if(!settingsMenuPlaceholder&&panel.parentElement!==document.body){
      settingsMenuPlaceholder=document.createComment('settings-panel-anchor');
      panel.before(settingsMenuPlaceholder);
      document.body.append(panel);
    }
    const rect=trigger.getBoundingClientRect();
    panel.classList.add('is-focused-menu');
    panel.style.top=Math.round(rect.bottom+10)+'px';
    panel.style.right=Math.max(12,Math.round(innerWidth-rect.right))+'px';
    panel.style.left='auto';
    setSettingsBackdrop(true);
  }else{
    setSettingsBackdrop(false);
    if(settingsMenuPlaceholder){
      settingsMenuTimer=setTimeout(()=>{
        if(trigger.getAttribute('aria-expanded')==='true')return;
        panel.classList.remove('is-focused-menu');
        panel.style.top='';panel.style.right='';panel.style.left='';
        settingsMenuPlaceholder.replaceWith(panel);
        settingsMenuPlaceholder=null;
      },205);
    }
  }
  setHeaderDrop('settings-panel','settings-toggle',open);
}
$('settings-toggle').onclick=()=>setMenu($('settings-toggle').getAttribute('aria-expanded')!=='true');
$('settings-close').onclick=()=>{setMenu(false);$('settings-toggle').focus();};
new MutationObserver(() => {
  $('message').hidden = !$('message').textContent;
  clearTimeout(toastTimer);
  if (!$('message').hidden) toastTimer = setTimeout(() => { $('message').hidden = true; }, 7000);
}).observe($('message'), {childList:true, characterData:true, subtree:true});

async function api(path, body) {
  if(globalThis.VertexBrowser?.enabled)return VertexBrowser.request(path,body);
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
  return HomeLibrary.refresh();

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
  const finish=startSessionLoading();
  try{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await loadSession(id);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  }finally{await finish();}
}
async function loadSession(id) {
  setPlaying(false);
  clearVideo();
  session = await api('sessions/' + id);
  clearAnalysisHover();preferredMapLap=null;expandedMetric=null;setMetricLayout();
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
  t = 0; zoom = 1; pan = [0, 0];
  if (session.meta.videoPath) {
    hasVideo = true;
    $('video-empty').hidden = true;
    if(globalThis.VertexBrowser?.enabled){try{await VertexBrowser.prepareVideo(id);$('video').src=VertexBrowser.videoURL(id);}catch(error){hasVideo=false;$('video-warning-a').hidden=false;$('video-warning-a').textContent=error.message;}}
    else $('video').src='/api/video/'+id;
    $('video-status').textContent = 'Video asociado por OBS. Si tu navegador no admite el formato, remultiplexa a MP4 H.264 y ábrelo con «Abrir video local».';
  } else {
    $('video-status').textContent = 'Sin video asociado. Puedes abrir uno local; las sesiones antiguas admiten ajuste manual.';
  }
  $('sync-status').textContent = session.meta.syncState === 'estimated'
    ? 'Sincronización automática por tramos de OBS; precisión estimada, pendiente de calibrar con una captura real.'
    : session.meta.syncState === 'recovered' ? 'Sincronización recuperada del registro real de OBS; alineación estimada.'
    : session.meta.syncState === 'error' ? 'Hubo un error de OBS. Revisa la grabación; la sincronización puede estar incompleta.' : 'Sin referencias automáticas de OBS.';
  if (videoOnly()) $('sync-status').textContent = 'El video está disponible, pero no tiene referencias de sincronización. Puedes reproducirlo por separado; las gráficas no moverán el video.';
  renderVideoControls(); seek(hasVideo&&!videoOnly()?RaceTimeline.nextPlayable(currentMeta(),0,playbackBounds().end)??0:0);
  restorePortableView(session.meta.portableView);
  if(hasVideo&&allMode&&!videoOnly()&&t===0&&toVideo(t)===null)seek(RaceTimeline.nextPlayable(currentMeta(),0,playbackBounds().end)??0);
  await list();
}

$('auto').onchange = action(async () => { await api('auto', {enabled: $('auto').checked}); });
$('record').onclick = requestManualRecording;
$('manual-record-confirm').onclick = action(async () => {
  if(manualBusy||latest?.recording)return;
  if(!liveConnection().online){$('manual-record-error').hidden=false;$('manual-record-error').textContent='Conecta Forza antes de iniciar la grabación.';return;}
  manualBusy=true;syncCaptureControls(latest);
  try{await api('start',{name:manualRequestedName});closeManualRecordingDialog();await list();}
  catch(error){$('manual-record-error').hidden=false;$('manual-record-error').textContent=error.message;}
  finally{manualBusy=false;syncCaptureControls(latest);}
});
$('stop').onclick = action(async () => {
  manualBusy=true;syncCaptureControls(latest);
  try{await api('stop',{});$('message').textContent='Sesión guardada. Ya está disponible en el selector.';await list();}finally{manualBusy=false;syncCaptureControls(latest);}
});
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
  const message=VertexPlayback.message(null,$('video'));
  $('video-status').textContent=message;$('video-warning-a').hidden=false;$('video-warning-a').textContent=message;$('message').textContent=message;
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
  $('mute').innerHTML = $('video').muted ? RaceIcons.muted : RaceIcons.volume;
}

function currentMeta() { return {...session?.meta, offset: Number($('offset').value) || 0}; }
function videoOnly() { return allMode && hasVideo && session?.meta.version === 2 && !session.meta.syncSegments?.length; }
function toVideo(time) { return session ? RaceTimeline.toVideo(currentMeta(), time) : null; }
function setVideoTime(value) {
  if (!Number.isFinite(value) || !Number.isFinite($('video').duration)) return;
  pendingSeek = Math.max(0, Math.min($('video').duration, value));
  $('video').currentTime = pendingSeek;
}
function seek(value, syncVideo = true) {
  if(videoOnly()){
    t=Math.max(0,Math.min(Number.isFinite($('video').duration)?$('video').duration:0,value));
    if(syncVideo)setVideoTime(t);
    $('time').value=t;draw();return;
  }
  const bounds=playbackBounds();
  t=Math.max(bounds.start,Math.min(bounds.end,value));
  refreshTransport();
  if(syncVideo)syncVideoPanes(true);
  draw();
}
function setPlaying(value) {
  playing = value;
  $('play').innerHTML = playing ? RaceIcons.pause : RaceIcons.play;
  $('play').setAttribute('aria-label',playing?'Pausar':'Reproducir');$('play').title=playing?'Pausar':'Reproducir';
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
  if(!playing&&hasVideo&&allMode&&!videoOnly()){
    const next=RaceTimeline.nextPlayable(currentMeta(),t,bounds.end,$('video').duration);
    if(next!==null&&next>t)seek(next);
  }
  if(playing){const shown=videoPlaybackClock();if(Number.isFinite(shown))t=Math.max(bounds.start,Math.min(bounds.end,shown));}
  setPlaying(!playing);refreshTransport();draw();
  syncVideoPanes(true);
};
$('rate').onchange = () => { $('video').playbackRate = Number($('rate').value); };
function canvas(id) {
  const element = $(id), rect = frameRects?.get(id)||element.getBoundingClientRect(), ratio = devicePixelRatio || 1;
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
let renderDirty=true,frameRects=null;
function textValue(id,value){const element=$(id),next=String(value);if(element.textContent!==next)element.textContent=next;}
const chartLayers=new Map();
let mapLayer=null;
function draw(){renderDirty=true;}
function paint() {
  if(homeActive)return;
  const renderStarted=performance.now();
  if(!session){drawInstruments((liveConnection().online||globalThis.VertexBrowser?.liveDemoActive?.())?liveSampleMemory:null);return;}
  frameRects=new Map(['map','telemetry-scroll',...metricDefs.map((m,i)=>i?'chart-'+m.key:'charts')].map(id=>[id,$(id).getBoundingClientRect()]));
  const laps=analysisSeries();
  const sample=observedSample();
  if (playing && sample && chartRange) {
    const full=analysisExtent();
    const next=RaceView.followRange(chartRange,[0,full],analysisX(sample));
    if (Math.abs(next.start-chartRange.start)>.001) { chartRange=next; scaleCache.clear(); }
  }
  $('clock').textContent = RaceAnalysis.clock(t-playbackBounds().start);
  textValue('map-speed',sample?`${sample.speed.toFixed(0)} km/h`:'— km/h');
  textValue('map-distance',sample?`${sample.d.toFixed(0)} m`:'— m');
  updateTelemetryContext();
  const legendLaps=visible(),nextLegend=(allMode?'all:':'laps:')+legendLaps.map(lap=>lap.id).join(',');
  if (legendKey !== nextLegend) {
    legendKey = nextLegend; $('lap-legend').replaceChildren();
    for (const lap of legendLaps) { const label = document.createElement('span'), dot = document.createElement('i'); dot.style.background = colors[lap.id % colors.length]; label.append(dot,lapLabel(lap));label.tabIndex=0;label.setAttribute('role','button');label.setAttribute('aria-label','Priorizar trazada de '+lapLabel(lap));label.title='Priorizar esta vuelta cuando las trazadas coincidan';label.onpointerenter=label.onfocus=()=>{preferredMapLap=lap.id;legendHoverLap=lap.id;draw();};label.onpointerleave=label.onblur=()=>{legendHoverLap=null;draw();};label.onclick=()=>{preferredMapLap=lap.id;legendHoverLap=lap.id;draw();};label.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();preferredMapLap=lap.id;legendHoverLap=lap.id;draw();}}; $('lap-legend').append(label); }
  }
  const [map, w, h] = canvas('map');
  mapSegments=[];
  const mapLaps=visible(),mapData=RaceRender.mapData(mapLaps),mapRows=mapData.rows;
  $('map-zoom-label').textContent=zoom.toFixed(1).replace('.0','')+'×';$('map').dataset.zoom=zoom;
  if(mapRows.length){
    const {xmin,xmax,zmin,zmax}=mapData;
    const center=[(xmin+xmax)/2,(zmin+zmax)/2],scale=Math.min((w-30)/(xmax-xmin||1),(h-30)/(zmax-zmin||1))*zoom;
    if(playing&&zoom>1&&sample&&!mapPointer?.moved)pan=RaceInteraction.cameraPan(sample,center,scale);
    const point=row=>[w/2+(row.x-center[0])*scale+pan[0],h/2-(row.z-center[1])*scale+pan[1]];
    const mapKey=JSON.stringify([session.meta.id,mapLaps.map(l=>[l.id,l.rows.length,l.rows.at(-1)?.t]),w,h,devicePixelRatio,zoom,pan,analysisHover?.kind==='map'?analysisHover.lapId:legendHoverLap]);
    const mapCached=mapLayer?.key===mapKey;
    if(mapCached){map.drawImage(mapLayer.image,0,0,w,h);mapSegments=mapLayer.segments;}
    else {
    for(const lap of mapLaps){
      const hovered=analysisHover?.kind==='map'&&analysisHover.lapId===lap.id||legendHoverLap===lap.id;
      map.strokeStyle=colors[lap.id%colors.length];map.lineWidth=hovered?3.3:1.8;
      map.globalAlpha=(analysisHover?.kind==='map'||legendHoverLap!==null)&&!hovered ? .24 : 1;
      map.shadowColor=map.strokeStyle;map.shadowBlur=hovered?8:0;map.beginPath();
      if(zoom>2){
        const rect={xmin:center[0]+(-w/2-pan[0]-12)/scale,xmax:center[0]+(w/2-pan[0]+12)/scale,zmin:center[1]-(h/2-pan[1]+12)/scale,zmax:center[1]-(-h/2-pan[1]-12)/scale};
        for(const segment of RaceRender.segments(lap.rows,rect)){const [ax,ay]=point(segment.a),[bx,by]=point(segment.b);map.moveTo(ax,ay);map.lineTo(bx,by);mapSegments.push({a:{x:ax,y:ay,t:segment.a.t,d:segment.a.d,row:segment.a},b:{x:bx,y:by,t:segment.b.t,d:segment.b.d,row:segment.b},lapId:lap.id});}
      }else{
      let previous=null;
      for(const row of lap.rows){
        const [x,y]=point(row),p={x,y,t:row.t,d:row.d,row};
        if(!previous||row.gap||row.breakBefore)map.moveTo(x,y);
        else{map.lineTo(x,y);if(Math.max(x,previous.x)>=-12&&Math.min(x,previous.x)<=w+12&&Math.max(y,previous.y)>=-12&&Math.min(y,previous.y)<=h+12)mapSegments.push({a:previous,b:p,lapId:lap.id});}
        previous=p;
      }
      }
      map.stroke();map.globalAlpha=1;map.shadowBlur=0;
    }
    const image=mapLayer?.image||document.createElement('canvas');if(image.width!==$('map').width||image.height!==$('map').height){image.width=$('map').width;image.height=$('map').height;}const layer=image.getContext('2d');layer.clearRect(0,0,image.width,image.height);layer.drawImage($('map'),0,0);mapLayer={key:mapKey,image,segments:mapSegments};
    }
    for(const lap of mapLaps){map.strokeStyle=colors[lap.id%colors.length];
      const current=allMode?(sample?.lapId===lap.id?sample:null):RaceAnalysis.sampleAtTime(lap.rows,RaceAnalysis.atElapsed(lap,t-playbackBounds().start)??NaN);
      if(current){map.fillStyle=map.strokeStyle;map.beginPath();map.arc(...point(current),lap.id===reference||allMode?5:3.5,0,Math.PI*2);map.fill();if(lap.id===reference||allMode){const p=point(current);$('map').dataset.carX=p[0];$('map').dataset.carY=p[1];}}
      if(analysisHover?.kind==='map'&&analysisHover.lapId===lap.id&&analysisHover?.row){map.strokeStyle='#fff3f5';map.lineWidth=1.5;map.beginPath();map.arc(...point(analysisHover.row),6,0,Math.PI*2);map.stroke();}
    }
  }else{map.fillStyle='#8997aa';map.font='12px Segoe UI';map.fillText('Abre una sesión para ver su recorrido.',20,h/2);}
  drawMetrics(sample, laps);
  const liveRecent = liveConnection().active;
  drawInstruments(session ? sample : (liveConnection().online || globalThis.VertexBrowser?.liveDemoActive?.()) ? liveSampleMemory : null);
  if (session && hasVideo && !videoOnly() && toVideo(t) === null) $('clock').textContent += ' · sin video';
  frameRects=null;
  $('workspace').dataset.renderMs=(performance.now()-renderStarted).toFixed(2);
}
let lapSummarySource=null;
function renderLapSummary(){
  const source=session?.laps||null;
  if(lapSummarySource===source&&$('lap-summary').childElementCount)return;
  lapSummarySource=source;
  const list=$('lap-summary');list.replaceChildren();
  const rows=RaceAnalysis.lapSummary(source||[]);
  if(!rows.length){const empty=document.createElement('li');empty.className='lap-summary-empty';empty.textContent=session?'Sin vueltas registradas':'Abre una sesión para ver sus vueltas';list.append(empty);return;}
  for(const row of rows){
    const item=document.createElement('li');item.className='lap-summary-item';item.classList.toggle('is-best',row.best);
    const label=document.createElement('span');label.className='lap-summary-label';label.textContent=lapLabel(row);
    const time=document.createElement('strong');time.textContent=RaceAnalysis.clock(row.time);
    const delta=document.createElement('small');delta.textContent=row.partial?'Parcial':row.best?'MEJOR VUELTA':row.delta===null?'Sin referencia':'+'+row.delta.toFixed(3)+' s';
    item.append(label,time,delta);list.append(item);
  }
}
function drawInstruments(sample) {
  const observedLap=allMode?sample?.lapId:reference;
  if(session&&observedLap!==undefined&&observedLap!==null&&$('reference').value!==String(observedLap))$('reference').value=String(observedLap);
  $('reference').disabled=!session;
  const rpm = sample?.rpm;
  const gearContext = session
    ? playing ? session.meta.id + ':' + reference : null
    : 'live:' + liveRpmCar;
  gearDisplayState = gearContext === null ? null
    : RaceInstruments.gearDisplay(gearDisplayState, gearContext, sample?.gear, performance.now());
  const gear = gearDisplayState?.gear ?? sample?.gear;
  const {ratio,maximum,engine} = RaceInstruments.rpmReference(sample,session?sessionRpmPeak:liveRpmPeak);
  textValue('instant-gear',Number.isFinite(gear) ? gear===0?'R':String(gear) : '—');
  textValue('instant-rpm',Number.isFinite(rpm) ? Math.round(rpm).toLocaleString('es-MX') : '—');
  textValue('instant-speed',Number.isFinite(sample?.speed) ? sample.speed.toFixed(0) : '—');
  $('rpm-fill').style.transform = `scaleX(${ratio ?? 0})`;
  textValue('rpm-scale',ratio === null ? 'Sin datos del motor' : `${engine?'Máximo del motor':'Pico medido · referencia visual'} · ${Math.round(maximum).toLocaleString('es-MX')} RPM`);
  $('rev-lights').classList.toggle('no-reading',ratio===null);
  const shiftKey=`${session?session.meta.id:'live:'+liveRpmCar}:${gear}`;
  const keepShift=(!session||playing)&&shiftMemory.key===shiftKey&&shiftMemory.active;
  revSweepState=RaceInstruments.revSweep(revSweepState,{context:session?session.meta.id+':'+playing:'live:'+liveRpmCar,gear,ratio,animate:!!sample&&(!session||playing)&&!revMotion.matches},performance.now());
  $('rev-lights').classList.toggle('is-sweeping',revSweepState.active);
  const lights=RaceInstruments.revLights(revSweepState.ratio,gear,sample?.speed,keepShift&&!revSweepState.active,document.body.classList.contains('live-view'));
  shiftMemory={key:shiftKey,active:lights.shift};
  $('rev-lights').classList.toggle('shift-alert',lights.shift);
  $('rev-lights').setAttribute('title',`Aviso de cambio estimado al 88% · ${maximum?Math.round(maximum*.88).toLocaleString('es-MX'):'—'} RPM · luces de las orillas al centro`);
  [...$('rev-lights').children].forEach((led,index)=>{led.classList.toggle('lit',lights.lit[index]);led.style.setProperty('--led-strength',lights.levels[index]);});
  $('instant-gear').dataset.highRpm = engine && ratio !== null && ratio>.95 ? 'true' : 'false';
  renderLapSummary();
  const measured = RaceInstruments.values(sample);
  textValue('instant-source',session ? 'Sesión · ' + t.toFixed(2) + ' s' : sample ? 'LIVE' : 'En espera');
  const missing = measured.steer === null || measured.lateral === null || measured.longitudinal === null || measured.tires.some(tire => tire.temp === null || tire.slip === null);
  textValue('instant-note',missing ? session ? 'Estos datos no se guardaban en sesiones anteriores.' : 'Esperando datos de conducción' : 'Valores del instante observado');
  $('steering-icon').classList.toggle('no-reading', measured.steer === null);
  $('steering-wheel').style.transform = `rotate(${(measured.steer ?? 0)*135}deg)`;
  textValue('steering-value',measured.steer === null ? 'Sin datos' : Math.abs(measured.steer)<.01 ? 'Centrado · 0%' : `${measured.steer<0?'Izq.':'Der.'} · ${Math.round(Math.abs(measured.steer)*100)}%`);
  $('steering-icon').setAttribute('aria-label', 'Entrada de dirección: ' + $('steering-value').textContent + '. El giro del icono es ilustrativo.');
  for (const key of ['throttle','brake']) {
    const value = sample?.[key];
    $('instant-'+key).style.transform = `scaleX(${Number.isFinite(value)?Math.max(0,Math.min(1,value/100)):0})`;
    $('instant-'+key+'-value').textContent = Number.isFinite(value) ? value.toFixed(0)+'%' : '—';
  }
  textValue('g-lateral',measured.lateral === null ? '—' : measured.lateral.toFixed(2)+' G');
  textValue('g-longitudinal',measured.longitudinal === null ? '—' : measured.longitudinal.toFixed(2)+' G');
  textValue('g-total',measured.total === null ? 'Sin datos' : measured.total.toFixed(2)+' G');
  $('g-point').style.opacity = measured.total === null ? 0 : 1;
  const gPos = RaceInstruments.gPointOffset(measured.lateral, measured.longitudinal, 55);
  $('g-point').style.transform = `translate(${gPos.x}px,${gPos.y}px)`;
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
  $('telemetry-scroll').setAttribute('aria-label',session ? allMode?'Gráficas por tiempo del instante observado':'Gráficas por tiempo desde el inicio de vuelta' : 'Gráficas en vivo de los últimos veinte segundos');
}
function metricScale(metric, series) {
  const cacheKey = metric.key + ':' + series.map(item => item.id).join(',');
  if (session && scaleCache.has(cacheKey)) return scaleCache.get(cacheKey);
  let min = 0, max = metric.max || 1;
  if(!metric.max)for(const item of series){const bounds=RaceRender.extent(item.rows,session?(allMode?'t':'elapsed'):'liveTime',metric.key,session&&chartRange?chartRange.start:-Infinity,session&&chartRange?chartRange.end:Infinity);min=Math.min(min,bounds[0]);max=Math.max(max,bounds[1]);}
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
  const rangeLabel = session ? allMode?`Tramo visible: ${RaceAnalysis.clock(range.start)} a ${RaceAnalysis.clock(range.end)}`:`Tramo visible: ${RaceAnalysis.clock(range.start)} a ${RaceAnalysis.clock(range.end)}` : `Tramo visible: hace ${(liveChartOffset+liveChartSpan).toFixed(1)} a ${liveChartOffset.toFixed(1)} segundos`;
  $('chart-pan').setAttribute('aria-valuetext',rangeLabel);
  $('chart-pan').title = available < .001 ? 'Acerca las gráficas para desplazarlas' : rangeLabel;
  const scrollRect = frameRects.get('telemetry-scroll');
  $('telemetry-rows').style.setProperty('--metric-height',Math.max(1,scrollRect.height/(expandedMetric?1:2))+'px');
  chartSegments=new Map();
  for (const [index, metric] of metricDefs.entries()) {
    const value = observed?.[metric.key];
    const duration = metric.divisor ? RaceInstruments.duration(value) : null;
    textValue('value-'+metric.key,duration ? duration.text : Number.isFinite(value) ? value.toFixed(metric.decimals) : '—');
    if (duration) $('value-' + metric.key).nextElementSibling.textContent=duration.unit;
    const id = index === 0 ? 'charts' : 'chart-' + metric.key, element = $(id), rect = frameRects.get(id);
    element.classList.toggle('live-chart', !session);
    element.setAttribute('aria-label', metric.name + (session ? allMode?' por tiempo':' por tiempo de vuelta' : ' en vivo'));
    if(element.closest('.metric-card').hidden||rect.bottom<=scrollRect.top||rect.top>=scrollRect.bottom)continue;
    const [chart, width, height] = canvas(id), [min, max] = metricScale(metric, series);
    const left = metric.divisor?58:28, right = width - 8, top = 6, bottom = height - 19;
    const end = (liveHistory.at(-1)?.liveTime || 0)-liveChartOffset;
    const point = row => [session ? left + (analysisX(row)-range.start)/span*(right-left) : left + (row.liveTime - (end-liveChartSpan))/liveChartSpan*(right-left), bottom - (row[metric.key]-min)/(max-min || 1)*(bottom-top)];
    const layerKey=JSON.stringify([session?.meta.id,allMode,series.map(item=>[item.id,item.rows.length,item.rows.at(-1)?.t]),range,width,height,devicePixelRatio,min,max,analysisHover?.kind==='chart'&&analysisHover.key===metric.key?analysisHover.lapId:null]);
    const cached=session&&chartLayers.get(metric.key);
    if(cached?.key===layerKey){chart.drawImage(cached.image,0,0,width,height);chartSegments.set(metric.key,cached.segments);}
    else {
    const axisValue=value=>{if(!metric.divisor)return value.toFixed(0);const d=RaceInstruments.duration(value);return d.text+' '+d.unit;};
    chart.font = '9px Segoe UI'; chart.fillStyle = '#7489a2'; chart.fillText(axisValue(max), 0, top+6); chart.fillText(axisValue(min), 0, bottom);
    chart.strokeStyle = '#26354a'; chart.lineWidth = 1; chart.beginPath(); chart.moveTo(left, bottom); chart.lineTo(right, bottom); chart.stroke();
    chart.save(); chart.beginPath(); chart.rect(left,top,right-left,bottom-top); chart.clip();
    const segments=[];chartSegments.set(metric.key,segments);
    for (const item of series) {
      const hovered=analysisHover?.kind==='chart'&&analysisHover.key===metric.key&&analysisHover.lapId===item.id;
      chart.globalAlpha=analysisHover?.kind==='chart'&&analysisHover.key===metric.key&&!hovered ? .25 : 1;
      chart.shadowBlur=hovered?7:0;
      chart.shadowColor=colors[item.id%colors.length];
      chart.strokeStyle = session ? colors[item.id % colors.length] : colors[0]; chart.lineWidth = hovered?2.8:1.4; chart.beginPath();
      let previous = null;
      for (const row of RaceRender.reduce(item.rows,session?(allMode?'t':'elapsed'):'liveTime',metric.key,session?range.start:end-liveChartSpan,session?range.end:end,right-left)) {
        if (!Number.isFinite(row[metric.key])) { previous = null; continue; }
        const p = point(row);
        if(previous&&!row.gap&&!row.breakBefore&&Math.max(p[0],previous[0])>=left&&Math.min(p[0],previous[0])<=right)segments.push({a:{x:previous[0],y:previous[1],t:previous.row.t,d:previous.row.d,row:previous.row},b:{x:p[0],y:p[1],t:row.t,d:row.d,row},lapId:allMode?row.lapId:item.id});
        p.row=row;
        if (!previous || row.gap || row.breakBefore) chart.moveTo(...p);
        else { if (metric.step) chart.lineTo(p[0], previous[1]); chart.lineTo(...p); }
        previous = p;
      }
      chart.stroke();
    }
    chart.globalAlpha=1;chart.shadowBlur=0;
    chart.restore();
    chart.fillStyle = '#7489a2'; chart.fillText(session ? RaceAnalysis.clock(range.start) : '−'+(liveChartSpan+liveChartOffset).toFixed(1)+' s', left, height-3);
    chart.textAlign = 'right'; chart.fillText(session ? RaceAnalysis.clock(range.end) : liveChartOffset<.01?'Ahora':'−'+liveChartOffset.toFixed(1)+' s', right, height-3); chart.textAlign = 'left';
    if(session){const image=cached?.image||document.createElement('canvas');if(image.width!==element.width||image.height!==element.height){image.width=element.width;image.height=element.height;}const layer=image.getContext('2d');layer.clearRect(0,0,image.width,image.height);layer.drawImage(element,0,0);chartLayers.set(metric.key,{key:layerKey,image,segments});}
    }
    chart.save();chart.beginPath();chart.rect(left,top,right-left,bottom-top);chart.clip();
    if(analysisHover?.kind==='chart'&&analysisHover.key===metric.key){const x=left+((allMode?analysisHover.time:analysisHover.time-RaceAnalysis.lapStart(session.laps.find(l=>l.id===analysisHover.lapId)))-range.start)/span*(right-left);chart.strokeStyle='#ffc2cb';chart.setLineDash([3,3]);chart.beginPath();chart.moveTo(x,top);chart.lineTo(x,bottom);chart.stroke();chart.setLineDash([]);}
    if (sample) { const x = left + (analysisX(sample)-range.start)/span*(right-left); chart.strokeStyle = '#e3fff0aa'; chart.beginPath(); chart.moveTo(x, top); chart.lineTo(x, bottom); chart.stroke(); }
    chart.restore();
  }
}
function chartSeek(event, syncVideo = true) {
  if (!session) return;
  const lap = session?.laps.find(item => item.id === reference);
  if (!allMode&&!lap?.rows.length) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const max=analysisExtent();
  const range = chartRange || {start:0,end:max};
  const left=['lapTime','raceTime'].includes(event.currentTarget.dataset.key)?58:28;
  const distance = range.start + Math.max(0, Math.min(1, (event.clientX-rect.left-left)/(rect.width-left-8))) * (range.end-range.start);
  const hit=RaceInteraction.hitSegments(chartSegments.get(event.currentTarget.dataset.key)||[],event.clientX-rect.left,event.clientY-rect.top,14,analysisHover?.lapId);
  if(hit){if(!allMode&&reference!==hit.lapId)seekHit(hit);else seek(hit.time,syncVideo);}
  else if(allMode)seek(distance,syncVideo);
  else seek(playbackBounds().start+distance,syncVideo);
}
for (const element of $('telemetry-rows').querySelectorAll('canvas')) {
  element.onpointerdown = event => { if (!session) return; chartDragging = true; element.setPointerCapture(event.pointerId); chartSeek(event); };
  element.onpointermove=event=>{if(chartDragging){chartSeek(event);return;}if(!session)return;const rect=element.getBoundingClientRect(),hit=RaceInteraction.hitSegments(chartSegments.get(element.dataset.key)||[],event.clientX-rect.left,event.clientY-rect.top,14,analysisHover?.kind==='chart'?analysisHover.lapId:null);showAnalysisHover(hit,event,'chart',element.dataset.key);draw();};
  element.onpointerleave=()=>{if(!chartDragging){clearAnalysisHover();draw();}};
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
$('map').addEventListener('wheel',event=>{event.preventDefault();const rect=$('map').getBoundingClientRect();zoomMap(Math.exp(-event.deltaY*.002),[event.clientX-rect.left,event.clientY-rect.top]);},{passive:false});
$('fit').onclick=()=>{zoom=1;pan=[0,0];clearAnalysisHover();draw();};
window.onresize=()=>{clearAnalysisHover();draw();};

function frame(now) {
  if (playing && videoOnly()) {
    const video = $('video');
    if (Number.isFinite(video.duration)) {
      if (video.ended) setPlaying(false);
      else VertexPlayback.play(video,error=>{setPlaying(false);$('message').textContent=VertexPlayback.message(error,video);});
      t = video.currentTime; $('time').value = t;
      $('clock').textContent = video.currentTime.toFixed(2) + ' s · video sin sincronizar';
    }
  } else if (playing && session) {
    const bounds=playbackBounds(),dt=Math.min((now-last)/1000,.1);
    const videoTime=videoPlaybackClock();videoClockActive=Number.isFinite(videoTime);
    t=Math.max(bounds.start,Math.min(bounds.end,Number.isFinite(videoTime)?videoTime:t+dt*Number($('rate').value)));
    syncVideoPanes(false,dt);refreshTransport();draw();
    if(t>=bounds.end)setPlaying(false);
  }
  if(revSweepState?.active)draw();
  if(renderDirty){renderDirty=false;paint();}
  last = now; requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function live(state) {
  liveCarMemory=RaceConnection.rememberCar(liveCarMemory,state);liveSampleMemory=RaceConnection.rememberSample(liveSampleMemory,state);latest = state;streamConnected=true;liveReceivedAt=Number.isFinite(state.packetAge)?performance.now()/1000:Date.now()/1000;updateLiveView();
  const connected = liveConnection().online;
  $('status').textContent = state.udpError ? 'Error UDP: '+state.udpError : `UDP ${connected ? 'activo' : 'en espera'} · ${state.packets} paquetes · ${state.invalid} rechazados · ${state.dropped} perdidos en cola`;
  $('auto').checked = state.auto;
  syncCaptureControls(state);
  $('obs-status').textContent = state.obs.error || (state.obs.connected ? `OBS conectado${state.obs.owned ? ' · grabación de VertexLab' : ' · listo'}` : state.obs.enabled ? 'OBS desconectado · revisa la conexión' : 'Sin conectar · sólo telemetría');
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
if(!globalThis.VertexBrowser?.enabled){
const events = new EventSource('/events');
events.onmessage = event => { try { live(JSON.parse(event.data)); } catch (e) { $('message').textContent = 'Error de actualización: '+e.message; } };
events.onerror = () => { streamConnected=false;updateLiveView();if(!session)draw();$('status').textContent = 'Servidor desconectado · reconectando…'; };
}
list().catch(e => { $('message').textContent = e.message; });
const resizeObserver = new ResizeObserver(() => requestAnimationFrame(draw));
setupAnalysisUI();setupPortableUI();setupLapScrollArrow();setupLapTimeline();setupRacingUI();setupViewUI();setupAnalysisInteractions();setupHome();
globalThis.VertexBrowser?.setup();
openHome();
resizeObserver.observe($('map')); resizeObserver.observe($('telemetry-scroll'));
draw();
