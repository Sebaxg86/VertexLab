/* Screen-space segment picking shared by the map, plots, and tests. */
(function(root){
 function hitSegments(segments,x,y,radius=12,preferred=null){
  let best=null;
  for(const s of segments){
   const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,length=dx*dx+dy*dy;
   const fraction=length?Math.max(0,Math.min(1,((x-s.a.x)*dx+(y-s.a.y)*dy)/length)):0;
   const px=s.a.x+dx*fraction,py=s.a.y+dy*fraction,dist=Math.hypot(x-px,y-py);
   if(dist>radius)continue;
   // Retain the hovered lap on nearly coincident lines instead of flickering.
   const score=dist-(s.lapId===preferred ? .75 : 0);
   if(!best||score<best.score)best={...s,score,distance:dist,x:px,y:py,time:s.a.t+(s.b.t-s.a.t)*fraction,d:s.a.d+(s.b.d-s.a.d)*fraction,row:fraction<.5?s.a.row:s.b.row};
  }
  return best;
 }
 function cameraPan(sample,center,scale){return [-(sample.x-center[0])*scale,(sample.z-center[1])*scale];}
 function scrollIndex(current,direction,count,visible=2){return Math.max(0,Math.min(count-visible,Math.round(current)+Math.sign(direction)));}
 root.RaceInteraction={hitSegments,cameraPan,scrollIndex};
 if(typeof module!=='undefined')module.exports=root.RaceInteraction;
})(globalThis);
