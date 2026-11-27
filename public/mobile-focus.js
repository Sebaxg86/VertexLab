/* Touch analysis: 3-level telemetry navigation and fluid iPhone transport scrubbing. */
(function(){
 const mobile=matchMedia('(max-width:600px)'),body=document.body;
 const viewport=document.querySelector('meta[name=viewport]');
 const viewportBase='width=device-width,initial-scale=1,viewport-fit=cover';
 const setViewport=()=>viewport.setAttribute('content',viewportBase+(mobile.matches?',maximum-scale=1,user-scalable=no':''));
 setViewport();mobile.addEventListener('change',setViewport);

 const telemetry=document.querySelector('.telemetry-column');
 const mapPanel=document.querySelector('.map-panel');
 const transport=document.querySelector('#player');
 const panels=[telemetry,mapPanel,transport];
 const scrollBox=document.querySelector('#telemetry-scroll');
 const time=document.querySelector('#time');

 const veil=document.createElement('div');
 veil.className='mobile-focus-veil';
 veil.hidden=true;

 const bar=document.createElement('div');
 bar.className='mobile-focus-bar';
 bar.hidden=true;

 const backBtn=document.createElement('button');
 backBtn.type='button';
 backBtn.className='mobile-focus-back';
 backBtn.textContent='← Gráficas';
 backBtn.hidden=true;
 backBtn.setAttribute('aria-label','Volver a la lista de gráficas');

 const hint=document.createElement('span');
 hint.className='mobile-focus-hint';

 const closeBtn=document.createElement('button');
 closeBtn.type='button';
 closeBtn.className='mobile-focus-close';
 closeBtn.textContent='Listo';
 closeBtn.setAttribute('aria-label','Salir del enfoque');

 bar.append(backBtn,hint,closeBtn);
 body.append(veil,bar);

 const telemetryHeading=telemetry?.querySelector('.telemetry-heading');
 if(telemetryHeading){
  const pill=document.createElement('span');
  pill.className='mobile-tap-pill';
  pill.setAttribute('aria-hidden','true');
  pill.textContent='Tocar para explorar';
  telemetryHeading.append(pill);
 }

 const scrubPill=document.createElement('output');
 scrubPill.id='mobile-scrub-pill';
 scrubPill.className='mobile-scrub-pill';
 scrubPill.setAttribute('aria-hidden','true');
 scrubPill.hidden=true;
 document.querySelector('.timeline-track-wrap')?.append(scrubPill);

 let active=null,placeholder=null,previous=null,exitTimer=null,transportMotion=null;
 let scrub=null,chartScrub=null,panelTap=null,cardTap=null;

 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

 function bounds(){
  const header=document.querySelector('.app-header').getBoundingClientRect();
  const video=document.querySelector('.video-panel').getBoundingClientRect();
  const top=Math.min(innerHeight*.56,Math.max(header.bottom,video.top<innerHeight&&video.bottom>header.bottom?video.bottom:header.bottom));
  body.style.setProperty('--focus-top',Math.max(0,top)+'px');
  if(active===transport)positionTransport();
 }

 function positionTransport(){
  const top=parseFloat(body.style.getPropertyValue('--focus-top'))||0;
  const height=transport.getBoundingClientRect().height;
  const safeBottom=28;
  body.style.setProperty('--player-focus-top',Math.max(top+16,top+(innerHeight-top-height-safeBottom)/2)+'px');
 }

 function moveTransport(from,to){
  transportMotion?.cancel();
  if(reduced())return;
  transportMotion=transport.animate([
   {translate:`${from.left-to.left}px ${from.top-to.top}px`,scale:`${from.width/to.width} ${from.height/to.height}`},
   {translate:'0px 0px',scale:'1 1'}
  ],{duration:280,easing:'cubic-bezier(.22,.8,.25,1)'});
 }

 function sync(){
  if(!active){
   body.classList.remove('mobile-chart-level3');
   if(telemetry)delete telemetry.dataset.level;
   bar.hidden=true;
   return;
  }
  const isTransport=active===transport;
  const isTelemetry=active===telemetry;
  const inLevel3=isTelemetry&&typeof expandedMetric!=='undefined'&&!!expandedMetric;
  body.classList.toggle('mobile-chart-level3',inLevel3);
  if(isTelemetry)telemetry.dataset.level=inLevel3?'3':'2';
  bar.hidden=isTransport;
  backBtn.hidden=!inLevel3;
  if(isTelemetry){
   hint.textContent=inLevel3?'Arrastra para recorrer la gráfica':'Toca una gráfica para manipular';
  }else if(active===mapPanel){
   hint.textContent='Arrastra o usa +/− para explorar';
  }else{
   hint.textContent='';
  }
  requestAnimationFrame(draw);
 }

 function endScrub(commit=true){
  if(!scrub)return;
  const current=scrub;
  scrub=null;
  if(current.raf)cancelAnimationFrame(current.raf);
  if(commit)applyScrub(current.frac,true);
  if(time.hasPointerCapture(current.id))time.releasePointerCapture(current.id);
  transport.classList.remove('is-scrubbing');
  scrubPill.hidden=true;
  if(commit&&current.wasPlaying&&typeof setPlaying==='function'){
   setPlaying(true);
   if(typeof syncVideoPanes==='function')syncVideoPanes(true);
  }
 }

 function endChartScrub(commit=true){
  if(!chartScrub)return;
  const current=chartScrub;
  chartScrub=null;
  if(current.raf)cancelAnimationFrame(current.raf);
  if(commit)applyChartScrub(current,true);
  if(current.el.hasPointerCapture(current.id))current.el.releasePointerCapture(current.id);
  current.el.classList.remove('is-scrubbing');
  if(commit&&current.wasPlaying&&typeof setPlaying==='function'){
   setPlaying(true);
   if(typeof syncVideoPanes==='function')syncVideoPanes(true);
  }
 }

 function exit(animate=false){
  if(!active)return;
  clearTimeout(exitTimer);
  endScrub(false);
  endChartScrub(false);
  const old=active,isTransport=old===transport,from=old.getBoundingClientRect();
  if(animate&&!isTransport&&!reduced()){
   old.classList.add('focus-leaving');
   veil.classList.add('focus-leaving');
   bar.classList.add('focus-leaving');
   exitTimer=setTimeout(()=>exit(false),180);
   return;
  }
  old.classList.remove('focus-leaving','mobile-focused','is-scrubbing');
  veil.classList.remove('focus-leaving');
  bar.classList.remove('focus-leaving');
  placeholder.replaceWith(old);
  active=null;placeholder=null;
  bar.hidden=true;
  body.classList.remove('mobile-analysis-focus','transport-focus','mobile-chart-level3');
  if(telemetry)delete telemetry.dataset.level;
  if(animate&&isTransport&&!reduced()){
   moveTransport(from,old.getBoundingClientRect());
   veil.classList.add('focus-leaving');
   exitTimer=setTimeout(()=>{veil.hidden=true;veil.classList.remove('focus-leaving');},280);
  }else{
   veil.hidden=true;
   transportMotion?.cancel();
  }
  if(typeof expandedMetric!=='undefined'&&expandedMetric){expandedMetric=null;setMetricLayout();}
  previous?.focus({preventScroll:true});
  requestAnimationFrame(draw);
 }

 function focus(panel){
  if(!panel||active===panel)return;
  exit(false);
  clearTimeout(exitTimer);
  veil.classList.remove('focus-leaving');
  bar.classList.remove('focus-leaving');
  const from=panel.getBoundingClientRect();
  bounds();
  previous=document.activeElement;
  placeholder=document.createComment('focused panel');
  panel.before(placeholder);
  body.append(panel);
  active=panel;
  body.classList.add('mobile-analysis-focus');
  panel.classList.add('mobile-focused');
  veil.hidden=false;
  const isTransport=panel===transport;
  if(isTransport){
   body.classList.add('transport-focus');
   positionTransport();
   moveTransport(from,panel.getBoundingClientRect());
  }
  sync();
  if(!isTransport)closeBtn.focus({preventScroll:true});
  requestAnimationFrame(draw);
 }

 backBtn.onclick=()=>{
  if(typeof expandedMetric!=='undefined'&&expandedMetric&&typeof toggleMetric==='function'){
   toggleMetric(expandedMetric);
  }
 };
 closeBtn.onclick=()=>exit(true);

 veil.addEventListener('pointerdown',e=>{e.stopPropagation();});
 veil.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();exit(true);});

 document.addEventListener('keydown',e=>{
  if(e.key!=='Escape'||!active)return;
  if(active===telemetry&&typeof expandedMetric!=='undefined'&&expandedMetric&&typeof toggleMetric==='function'){
   toggleMetric(expandedMetric);
   return;
  }
  exit(true);
 });

 mobile.addEventListener('change',()=>{if(!mobile.matches)exit(false);});
 window.addEventListener('resize',()=>{if(active)bounds();});
 document.addEventListener('touchmove',e=>{if(mobile.matches&&e.touches.length>1)e.preventDefault();},{passive:false});
 document.addEventListener('gesturestart',e=>{if(mobile.matches)e.preventDefault();},{passive:false});

 function fraction(x,rect){return Math.max(0,Math.min(1,(x-rect.left-8)/Math.max(1,rect.width-16)));}

 function updateScrubPill(frac,rel){
  const text=typeof RaceAnalysis!=='undefined'?RaceAnalysis.clock(rel):rel.toFixed(2)+' s';
  scrubPill.textContent=text;
  scrubPill.style.left=Math.max(6,Math.min(94,frac*100)).toFixed(2)+'%';
  scrubPill.hidden=false;
 }

 function applyScrub(frac,forceVideo=false){
  const min=Number(time.min)||0,max=Number(time.max)||0;
  const rel=min+(max-min)*frac;
  const b=typeof playbackBounds==='function'?playbackBounds():{start:0};
  const target=(typeof videoOnly==='function'&&videoOnly())?rel:b.start+rel;
  const now=performance.now();
  const videoEl=document.getElementById('video');
  const canSync=forceVideo||(!videoEl?.seeking&&now-(scrub?.lastVideoSync||0)>=90);
  if(canSync&&scrub)scrub.lastVideoSync=now;
  if(typeof seek==='function')seek(target,canSync);
  else{time.value=rel;time.dispatchEvent(new Event('input',{bubbles:true}));}
  updateScrubPill(frac,rel);
 }

 function beginScrub(event){
  if(event.button!==0)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const wasPlaying=typeof playing!=='undefined'&&!!playing;
  if(wasPlaying&&typeof setPlaying==='function')setPlaying(false);
  const frac=fraction(event.clientX,time.getBoundingClientRect());
  scrub={id:event.pointerId,frac,wasPlaying,raf:0,lastVideoSync:0};
  time.setPointerCapture(event.pointerId);
  transport.classList.add('is-scrubbing');
  applyScrub(frac,true);
 }

 time.addEventListener('pointermove',event=>{
  if(!scrub||event.pointerId!==scrub.id)return;
  event.preventDefault();
  scrub.frac=fraction(event.clientX,time.getBoundingClientRect());
  if(!scrub.raf){
   scrub.raf=requestAnimationFrame(()=>{
    if(!scrub)return;
    scrub.raf=0;
    applyScrub(scrub.frac,false);
   });
  }
 });
 window.addEventListener('pointerup',event=>{
  if(scrub&&event.pointerId===scrub.id)endScrub(true);
  if(chartScrub&&event.pointerId===chartScrub.id)endChartScrub(true);
 });
 window.addEventListener('pointercancel',event=>{
  if(scrub&&event.pointerId===scrub.id)endScrub(true);
  if(chartScrub&&event.pointerId===chartScrub.id)endChartScrub(true);
 });

 function applyChartScrub(state,forceVideo=false){
  const now=performance.now();
  const videoEl=document.getElementById('video');
  const canSync=forceVideo||(!videoEl?.seeking&&now-state.lastVideoSync>=90);
  if(canSync)state.lastVideoSync=now;
  if(typeof chartSeek==='function'){
   chartSeek({currentTarget:state.el,clientX:state.x,clientY:state.y},canSync);
  }
 }

 function beginChartScrub(canvas,event){
  if(event.button!==0)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const wasPlaying=typeof playing!=='undefined'&&!!playing;
  if(wasPlaying&&typeof setPlaying==='function')setPlaying(false);
  chartScrub={id:event.pointerId,el:canvas,x:event.clientX,y:event.clientY,raf:0,lastVideoSync:0,wasPlaying};
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('is-scrubbing');
  applyChartScrub(chartScrub,true);
 }

 for(const panel of panels){
  if(!panel)continue;
  panel.addEventListener('pointerdown',e=>{
   if(!mobile.matches||!session)return;
   if(active!==panel){
    panelTap={panel,id:e.pointerId,x:e.clientX,y:e.clientY,scrollY:window.scrollY,moved:false};
    return;
   }
   if(panel===transport&&e.target.closest('.timeline-control')){
    beginScrub(e);
    return;
   }
   if(panel===telemetry){
    const canvas=e.target.closest('.metric-card canvas');
    if(canvas&&typeof expandedMetric!=='undefined'&&expandedMetric===canvas.dataset.key){
     beginChartScrub(canvas,e);
     return;
    }
    const card=e.target.closest('.metric-card');
    if(card&&!expandedMetric){
     if(canvas)e.stopImmediatePropagation();
     cardTap={card,id:e.pointerId,x:e.clientX,y:e.clientY,scrollTop:scrollBox?.scrollTop||0,moved:false};
    }
   }
  },true);

  panel.addEventListener('pointermove',e=>{
   if(!mobile.matches||!session)return;
   if(panelTap&&panelTap.panel===panel&&panelTap.id===e.pointerId){
    if(Math.hypot(e.clientX-panelTap.x,e.clientY-panelTap.y)>10||Math.abs(window.scrollY-panelTap.scrollY)>6){
     panelTap.moved=true;
    }
   }
   if(panel===telemetry&&cardTap&&cardTap.id===e.pointerId){
    if(Math.hypot(e.clientX-cardTap.x,e.clientY-cardTap.y)>10||Math.abs((scrollBox?.scrollTop||0)-cardTap.scrollTop)>6){
     cardTap.moved=true;
    }
   }
   if(panel===telemetry&&chartScrub&&chartScrub.id===e.pointerId){
    e.preventDefault();
    e.stopImmediatePropagation();
    chartScrub.x=e.clientX;
    chartScrub.y=e.clientY;
    if(!chartScrub.raf){
     chartScrub.raf=requestAnimationFrame(()=>{
      if(!chartScrub)return;
      chartScrub.raf=0;
      applyChartScrub(chartScrub,false);
     });
    }
   }
  },true);

  panel.addEventListener('click',e=>{
   if(!mobile.matches||!session)return;
   if(active!==panel){
    e.preventDefault();
    e.stopImmediatePropagation();
    const isTap=e.detail===0||!panelTap||panelTap.panel!==panel||!panelTap.moved;
    panelTap=null;
    if(isTap)focus(panel);
    return;
   }
   if(panel===telemetry&&!expandedMetric){
    const card=e.target.closest('.metric-card');
    if(card){
     e.preventDefault();
     e.stopImmediatePropagation();
     const isTap=e.detail===0||!cardTap||cardTap.card!==card||!cardTap.moved;
     cardTap=null;
     const key=card.querySelector('canvas')?.dataset.key;
     if(isTap&&key&&typeof toggleMetric==='function')toggleMetric(key);
    }
   }
  },true);
 }

 globalThis.VertexMobileFocus={exit,sync};
})();
