(function(){
 let active=null,closing=null;
 function hide(){if(!active)return;const item=active;active=null;item.tip.classList.remove('is-visible');clearTimeout(closing);closing=setTimeout(()=>{if(active?.tip!==item.tip)item.tip.hidden=true;},160);}
 function show(button){const tip=document.getElementById(button.dataset.help);if(!tip||active?.button===button)return;hide();clearTimeout(closing);for(const other of document.querySelectorAll('.help-tooltip'))if(other!==tip){other.hidden=true;other.classList.remove('is-visible');}active={button,tip};document.body.append(tip);tip.hidden=false;const rect=button.getBoundingClientRect(),box=tip.getBoundingClientRect();tip.style.left=Math.max(10,Math.min(innerWidth-box.width-10,rect.right-box.width))+'px';tip.style.top=Math.max(10,rect.bottom+box.height+12>innerHeight?rect.top-box.height-9:rect.bottom+9)+'px';requestAnimationFrame(()=>{if(active?.tip===tip)tip.classList.add('is-visible');});}
 document.addEventListener('pointerover',event=>{const button=event.target.closest('.help-trigger');if(button)show(button);});
 document.addEventListener('pointerout',event=>{const button=event.target.closest('.help-trigger');if(button&&!button.contains(event.relatedTarget))hide();});
 document.addEventListener('focusin',event=>{if(event.target.matches('.help-trigger'))show(event.target);});
 document.addEventListener('focusout',event=>{if(event.target.matches('.help-trigger'))hide();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
 window.addEventListener('resize',hide);document.addEventListener('scroll',hide,true);
})();
