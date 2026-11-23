/* Same lap/distance rules as telemetry.analyze; no inferred missing readings. */
(function(root){
  class LapBuilder{
    constructor(){this.laps=[];this.previousTime=-Infinity;this.count=0;}
    push(raw){
      for(const key of ['t','timestamp','lap','x','z','speed'])if(!Number.isFinite(raw?.[key]))throw Error('Muestra de telemetría inválida');
      if(raw.t<0||raw.t<this.previousTime)throw Error('La telemetría no está ordenada');
      this.previousTime=raw.t;
      let lap=this.laps.at(-1);
      if(!lap||raw.lap!==lap.number||raw.timestamp<lap.rows.at(-1).timestamp){lap={number:raw.lap,rows:[],partial:true,id:this.laps.length};this.laps.push(lap);}
      const previous=lap.rows.at(-1),row={...raw};
      const step=previous?Math.hypot(row.x-previous.x,row.z-previous.z):0;
      row.gap=!!(previous&&(row.breakBefore||row.t-previous.t>1||step>100));
      row.d=(previous?.d||0)+(row.gap?0:step);lap.rows.push(row);this.count++;
    }
    finish(){if(!this.count)throw Error('La sesión no contiene telemetría');this.laps.forEach((lap,i)=>{lap.partial=i===0||i===this.laps.length-1||lap.rows.some(row=>row.gap);});return this.laps;}
  }
  function analyze(rows){const builder=new LapBuilder();for(const row of rows)builder.push(row);return builder.finish();}
  function metadata(meta){
    if(!meta||typeof meta!=='object'||typeof meta.name!=='string'||meta.name.length>256||!Number.isFinite(meta.created)||![1,2].includes(meta.version??1))throw Error('Metadatos de sesión inválidos');
    for(const segment of meta.syncSegments||[])if(!['tStart','tEnd','videoStart'].every(k=>Number.isFinite(segment?.[k]))||segment.tEnd<segment.tStart)throw Error('Sincronización inválida');
    return meta;
  }
  function preview(laps,meta){
    const free=meta.automatic===false&&!laps.some(l=>l.rows.some(r=>(r.racePosition||0)>0||(r.lapTime||0)>0));
    const choices=free?[{rows:laps.flatMap(l=>l.rows),source:'session'}]:[laps[1],laps[0]].filter(Boolean);
    for(const lap of choices){const rows=lap.rows;if(rows.length<2)continue;
      let xmin=Infinity,xmax=-Infinity,zmin=Infinity,zmax=-Infinity;
      for(const r of rows){xmin=Math.min(xmin,r.x);xmax=Math.max(xmax,r.x);zmin=Math.min(zmin,r.z);zmax=Math.max(zmax,r.z);}
      if(Math.max(xmax-xmin,zmax-zmin)<.01)continue;
      const scale=Math.min(80/(xmax-xmin||1),48/(zmax-zmin||1)),stride=Math.max(1,Math.ceil(rows.length/180)),commands=[];
      rows.forEach((r,i)=>{const previous=rows[i-1],gap=!previous||r.gap||r.breakBefore||r.t-previous.t>1||Math.hypot(r.x-previous.x,r.z-previous.z)>100;if(i%stride&&!gap&&i!==rows.length-1)return;commands.push(`${gap?'M':'L'}${(48+(r.x-(xmin+xmax)/2)*scale).toFixed(2)},${(32-(r.z-(zmin+zmax)/2)*scale).toFixed(2)}`);});
      return {path:commands.join(' '),source:free?'session':'lap',recordedLap:lap.id+1,recordedLapNumber:lap.number+1,partial:lap.partial};
    }return null;
  }
  root.VertexBrowserCore={LapBuilder,analyze,metadata,preview};if(typeof module!=='undefined')module.exports=root.VertexBrowserCore;
})(globalThis);
