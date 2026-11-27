/* Small, shared library rules. No telemetry/video is loaded to browse sessions. */
(function(root){
 function page(items,offset=0,limit=12){
  const ordered=[...items].sort((a,b)=>(b.created||0)-(a.created||0)||String(a.id).localeCompare(String(b.id)));
  offset=Math.max(0,Math.trunc(Number(offset)||0));limit=Math.max(1,Math.min(48,Math.trunc(Number(limit)||12)));
  const end=Math.min(ordered.length,offset+limit);
  return {items:ordered.slice(offset,end),total:ordered.length,nextOffset:end<ordered.length?end:null};
 }
 function windowRange(count,scroll,height,rowHeight=112,overscan=3){
  const start=Math.max(0,Math.min(count,Math.floor(Math.max(0,scroll)/rowHeight)-overscan));
  const end=Math.min(count,Math.max(start,Math.ceil((Math.max(0,scroll)+Math.max(0,height))/rowHeight)+overscan));
  return {start,end,top:start*rowHeight,bottom:(count-end)*rowHeight};
 }
 function availability(item){return {local:item.availability?.local!==false,cloud:item.availability?.cloud===true,temporary:item.availability?.temporary===true};}
 function actions(item,activeId,cloudState){
  const state=availability(item),active=item.id===activeId,connected=!!cloudState?.connected;
  return [
   {key:'favorite',label:item.featured?'Quitar favorito':'Marcar favorito',enabled:true},
   ...(state.local&&!state.cloud?[{key:'sync',label:'Sincronizar con Google Drive',enabled:connected&&!active,soon:!connected}]:[]),
   ...(!state.local&&state.cloud?[{key:'download',label:'Descargar a este dispositivo',enabled:connected,soon:!connected}]:[]),
   ...(state.local?[{key:'delete-local',label:'Eliminar de este dispositivo…',enabled:!active,danger:true}]:[]),
   ...(state.cloud?[{key:'delete-cloud',label:'Eliminar de Google Drive…',enabled:connected&&!active,soon:!connected,danger:true}]:[]),
   {key:'delete-all',label:'Eliminar definitivamente…',enabled:!active&&(!state.cloud||connected),danger:true}
  ];
 }
 function snapTop(top,max,rowHeight=112){max=Math.max(0,max);top=Math.max(0,Math.min(max,top));if(max-top<=1)return max;return Math.max(0,Math.min(Math.floor(max/rowHeight),Math.round(top/rowHeight)))*rowHeight;}

 function classLabel(id,pi){
  // FH6 Data Out: D=0 through X=7. Some senders still report X as 6 / 999.
  if(id===6&&pi===999)return 'X';
  return Number.isInteger(id)?['D','C','B','A','S1','S2','R','X'][id]||null:null;
 }
 const api={page,windowRange,availability,actions,snapTop,classLabel};root.VertexHomeModel=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
