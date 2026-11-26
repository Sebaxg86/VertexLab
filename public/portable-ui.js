function capturePortableView(){
  const rect=$('map').getBoundingClientRect();
  return {version:1,comparisonAxis:'elapsed',offset:Number($('offset').value)||0,allMode,selected:[...selected],reference,t,videoChoices:[...videoChoices],chartRange,
    zoom,panNormalized:[pan[0]/Math.max(1,rect.width),pan[1]/Math.max(1,rect.height)],
    expandedMetric,metricIndex:Math.round($('telemetry-scroll').scrollTop/Math.max(1,$('telemetry-scroll').clientHeight/2)),
    rate:Number($('rate').value),volume:$('video').volume,muted:$('video').muted};
}
function restorePortableView(raw){
  if(!raw||!Object.keys(raw).length)return;
  const view=VertexPortableView.normalize(raw,session.laps,metricDefs.map(m=>m.key));
  allMode=view.allMode;selected=new Set(view.selected);reference=view.reference;videoChoices=view.videoChoices;
  chartRange=view.chartRange;zoom=view.zoom;
  const rect=$('map').getBoundingClientRect();pan=[view.panNormalized[0]*rect.width,view.panNormalized[1]*rect.height];
  expandedMetric=view.expandedMetric;setMetricLayout();scaleCache.clear();legendKey=null;
  $('rate').value=String(view.rate);$('video').volume=view.volume;$('video').muted=view.muted;$('volume').value=String(view.volume);updateVolume();
  renderAnalysisMenu();renderVideoControls();refreshTransport();seek(view.t);
  requestAnimationFrame(()=>{$('telemetry-scroll').scrollTop=expandedMetric?0:view.metricIndex*$('telemetry-scroll').clientHeight/2;draw();});
}
function setupPortableUI(){
  $('import-session').onclick=()=>$('portable-file').click();
  $('portable-file').onchange=async()=>{
    const file=$('portable-file').files[0];$('portable-file').value='';if(!file)return;
    const finish=startSessionLoading('Importando sesión','Verificando video y telemetría');
    try{
      let result;
      if(globalThis.VertexBrowser?.enabled){result=await VertexBrowser.open(file,progress=>{document.querySelector('.session-loading-card>span').textContent=progress.phase+' · '+progress.percent+'%';});}
      else{
      const response=await fetch('/api/portable/import',{method:'POST',headers:{'Content-Type':'application/vnd.vertexlab.session+zip'},body:file});
      result=await response.json();if(!response.ok)throw Error(result.error);
      }
      await list();await transitionView(()=>load(result.id));setSessionPicker(false);
      $('message').textContent=globalThis.VertexBrowser?.enabled?($('library-save')?.checked?'Sesión guardada en la biblioteca de este dispositivo.':'Sesión temporal abierta. No se guardará en la biblioteca.'):'Sesión importada. Video, telemetría y análisis disponibles en este equipo.';
    }catch(error){$('message').textContent=error.message;}finally{await finish();}
  };
  $('export-session').onclick=action(async()=>{
    if(!session)return;
    if(globalThis.VertexBrowser?.enabled){const file=VertexBrowser.original(session.meta.id),url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);setMenu(false);$('message').textContent='Se descarga el archivo original; conserva el estado de análisis con el que fue exportado.';return;}
    if(objectUrl)throw Error('El video abierto temporalmente debe asociarse a la sesión antes de exportar.');
    setPlaying(false);setMenu(false);const view=capturePortableView();
    const finish=startSessionLoading('Preparando archivo .vrtx','Empaquetando el video original y la telemetría');
    try{
      const result=await api('portable/export/'+session.meta.id,{view});
      const link=document.createElement('a');link.href=result.url;link.download=result.name;document.body.append(link);link.click();link.remove();
      $('message').textContent='Descarga .vrtx iniciada. Incluye la sesión completa y el punto de análisis actual.';
    }finally{await finish();}
  });
}
