/* Touch analysis: browsing never seeks until a metric is explicitly expanded. */
(function(){
 const mobile=matchMedia('(max-width:600px)'),body=document.body;
 const viewport=document.querySelector('meta[name=viewport]');
 const viewportBase='width=device-width,initial-scale=1,viewport-fit=cover';
 const setViewport=()=>viewport.setAttribute('content',viewportBase+(mobile.matches?',maximum-scale=1,user-scalable=no':''));
 setViewport();mobile.addEventListener('change',setViewport);
 const panels=[document.querySelector('.telemetry-column'),document.querySelector('.map-panel'),document.querySelector('#player')];
 const veil=document.createElement('div');veil.className='mobile-focus-veil';veil.hidden=true;
 const close=document.createElement('button');close.className='mobile-focus-close';close.textContent='Listo';close.hidden=true;close.setAttribute('aria-label','Salir del enfoque');
 body.append(veil,close);
 let active=null,placeholder=null,previous=null,exitTimer=null;
 function bounds(){
  const header=document.querySelector('.app-header').getBoundingClientRect(),video=document.querySelector('.video-panel').getBoundingClientRect();
  const top=Math.min(innerHeight*.58,Math.max(header.bottom,video.top<innerHeight&&video.bottom>header.bottom?video.bottom:header.bottom));
  body.style.setProperty('--focus-top',Math.max(0,top)+ 'px');
 }
 function exit(animate=false){
  if(!active)return;
  clearTimeout(exitTimer);
  if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){active.classList.add('focus-leaving');veil.classList.add('focus-leaving');exitTimer=setTimeout(()=>exit(),180);return;}
  const old=active;old.classList.remove('focus-leaving');veil.classList.remove('focus-leaving');old.classList.remove('mobile-focused','is-scrubbing');placeholder.replaceWith(old);active=null;placeholder=null;
  veil.hidden=close.hidden=true;body.classList.remove('mobile-analysis-focus');
  if(expandedMetric){expandedMetric=null;setMetricLayout();}
  previous?.focus({preventScroll:true});requestAnimationFrame(draw);
 }
 function focus(panel){
  exit();bounds();previous=document.activeElement;placeholder=document.createComment('focused panel');panel.before(placeholder);body.append(panel);active=panel;
  body.classList.add('mobile-analysis-focus');panel.classList.add('mobile-focused');veil.hidden=close.hidden=false;close.focus({preventScroll:true});requestAnimationFrame(draw);
 }
 close.onclick=veil.onclick=()=>exit(true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')exit(true);});
 mobile.addEventListener('change',()=>{if(!mobile.matches)exit();});window.addEventListener('resize',()=>{if(active)bounds();});
 document.addEventListener('touchmove',e=>{if(mobile.matches&&e.touches.length>1)e.preventDefault();},{passive:false});
 document.addEventListener('gesturestart',e=>{if(mobile.matches)e.preventDefault();},{passive:false});
 for(const panel of panels){
  panel.addEventListener('pointerdown',e=>{
   if(!mobile.matches||!session)return;
   if(active!==panel){e.stopImmediatePropagation();if(e.target.matches('input[type=range]')){e.preventDefault();focus(panel);}return;}
   const canvas=e.target.closest('.metric-card canvas');
   if(canvas&&expandedMetric!==canvas.dataset.key){e.stopImmediatePropagation();}
  },true);
  panel.addEventListener('click',e=>{
   if(!mobile.matches||!session)return;
   if(active!==panel){e.preventDefault();e.stopImmediatePropagation();focus(panel);return;}
   const canvas=e.target.closest('.metric-card canvas');
   if(canvas&&expandedMetric!==canvas.dataset.key){e.preventDefault();e.stopImmediatePropagation();toggleMetric(canvas.dataset.key);}
  },true);
 }
 const time=document.querySelector('#time');
 time.addEventListener('pointerdown',()=>{if(mobile.matches&&active===panels[2])panels[2].classList.add('is-scrubbing');});
 const end=()=>panels[2].classList.remove('is-scrubbing');window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
})();
