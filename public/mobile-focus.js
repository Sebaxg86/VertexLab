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
 let active=null,placeholder=null,previous=null,exitTimer=null,transportMotion=null,scrub=null,holdTimer=null;
 function bounds(){
  const header=document.querySelector('.app-header').getBoundingClientRect(),video=document.querySelector('.video-panel').getBoundingClientRect();
  const top=Math.min(innerHeight*.58,Math.max(header.bottom,video.top<innerHeight&&video.bottom>header.bottom?video.bottom:header.bottom));
  body.style.setProperty('--focus-top',Math.max(0,top)+ 'px');
  if(active===panels[2])positionTransport();
 }
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 function positionTransport(){
  const top=parseFloat(body.style.getPropertyValue('--focus-top'))||0;
  const height=panels[2].getBoundingClientRect().height;
  body.style.setProperty('--player-focus-top',Math.max(top+16,top+(innerHeight-top-height-40)/2)+'px');
 }
 function moveTransport(from,to){
  transportMotion?.cancel();
  if(reduced())return;
  transportMotion=panels[2].animate([
   {translate:`${from.left-to.left}px ${from.top-to.top}px`,scale:`${from.width/to.width} ${from.height/to.height}`},
   {translate:'0px 0px',scale:'1 1'}
  ],{duration:320,easing:'cubic-bezier(.22,.8,.25,1)'});
 }
 function exit(animate=false){
  if(!active)return;
  clearTimeout(exitTimer);endScrub();
  const old=active,isTransport=old===panels[2],from=old.getBoundingClientRect();
  if(animate&&!isTransport&&!reduced()){old.classList.add('focus-leaving');veil.classList.add('focus-leaving');exitTimer=setTimeout(()=>exit(),180);return;}
  old.classList.remove('focus-leaving');veil.classList.remove('focus-leaving');old.classList.remove('mobile-focused','is-scrubbing');placeholder.replaceWith(old);active=null;placeholder=null;
  close.hidden=true;body.classList.remove('mobile-analysis-focus','transport-focus');
  if(animate&&isTransport&&!reduced()){
   moveTransport(from,old.getBoundingClientRect());
   veil.classList.add('focus-leaving');exitTimer=setTimeout(()=>{veil.hidden=true;veil.classList.remove('focus-leaving');},320);
  }else{veil.hidden=true;transportMotion?.cancel();}
  if(expandedMetric){expandedMetric=null;setMetricLayout();}
  previous?.focus({preventScroll:true});requestAnimationFrame(draw);
 }
 function focus(panel){
  exit();clearTimeout(exitTimer);veil.classList.remove('focus-leaving');
  const from=panel.getBoundingClientRect();bounds();previous=document.activeElement;placeholder=document.createComment('focused panel');panel.before(placeholder);body.append(panel);active=panel;
  body.classList.add('mobile-analysis-focus');panel.classList.add('mobile-focused');veil.hidden=false;
  const isTransport=panel===panels[2];close.hidden=isTransport;
  if(isTransport){body.classList.add('transport-focus');positionTransport();moveTransport(from,panel.getBoundingClientRect());}
  else close.focus({preventScroll:true});requestAnimationFrame(draw);
 }
 let backdropPressed=false;
 close.onclick=()=>exit(true);
 veil.addEventListener('pointerdown',()=>{backdropPressed=true;});
 veil.onclick=()=>{if(backdropPressed)exit(true);backdropPressed=false;};
 veil.addEventListener('pointercancel',()=>{backdropPressed=false;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')exit(true);});
 mobile.addEventListener('change',()=>{if(!mobile.matches)exit();});window.addEventListener('resize',()=>{if(active)bounds();});
 document.addEventListener('touchmove',e=>{if(mobile.matches&&e.touches.length>1)e.preventDefault();},{passive:false});
 document.addEventListener('gesturestart',e=>{if(mobile.matches)e.preventDefault();},{passive:false});
 for(const panel of panels){
  panel.addEventListener('pointerdown',e=>{
   if(!mobile.matches||!session)return;
   if(panel===panels[2]&&e.target.closest('.timeline-control')){beginScrub(e);return;}
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
 function fraction(x,rect){return Math.max(0,Math.min(1,(x-rect.left-6)/Math.max(1,rect.width-12)));}
 function seekFraction(value){
  time.value=Number(time.min)+(Number(time.max)-Number(time.min))*value;
  time.dispatchEvent(new Event('input',{bubbles:true}));
 }
 function beginScrub(event){
  if(event.button!==0)return;
  event.preventDefault();event.stopImmediatePropagation();
  const initial=fraction(event.clientX,time.getBoundingClientRect()),wasFocused=active===panels[2];
  if(!wasFocused)focus(panels[2]);
  scrub={id:event.pointerId,startX:event.clientX,initial,ready:wasFocused};
  time.setPointerCapture(event.pointerId);
  if(wasFocused){panels[2].classList.add('is-scrubbing');seekFraction(initial);}
  else holdTimer=setTimeout(()=>{if(!scrub)return;scrub.ready=true;panels[2].classList.add('is-scrubbing');seekFraction(scrub.initial);},320);
 }
 time.addEventListener('pointermove',event=>{
  if(!scrub||scrub.id!==event.pointerId)return;
  event.preventDefault();
  if(!scrub.ready)return;
  panels[2].classList.add('is-scrubbing');
  seekFraction(fraction(event.clientX,time.getBoundingClientRect()));
 });
 function endScrub(){clearTimeout(holdTimer);if(scrub&&time.hasPointerCapture(scrub.id))time.releasePointerCapture(scrub.id);scrub=null;panels[2].classList.remove('is-scrubbing');}
 window.addEventListener('pointerup',endScrub);window.addEventListener('pointercancel',endScrub);
})();
