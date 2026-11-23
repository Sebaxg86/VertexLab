/* Display-only reduction; recordings and analysis samples remain untouched. */
(function(root){
  function lower(rows,key,value){let a=0,b=rows.length;while(a<b){const m=(a+b)>>>1;if(rows[m][key]<value)a=m+1;else b=m;}return a;}
  function reduce(rows,x,y,start,end,width){
    const first=Math.max(0,lower(rows,x,start)-1),last=Math.min(rows.length,lower(rows,x,end)+1),out=[];
    let bucket=[],column=null;
    function flush(){if(!bucket.length)return;let min=0,max=0;for(let i=1;i<bucket.length;i++){if(bucket[i][y]<bucket[min][y])min=i;if(bucket[i][y]>bucket[max][y])max=i;}for(const i of [...new Set([0,min,max,bucket.length-1])].sort((a,b)=>a-b))out.push(bucket[i]);bucket=[];}
    for(let i=first;i<last;i++){const row=rows[i],next=Math.floor((row[x]-start)/Math.max(.001,end-start)*width);if(row.gap||row.breakBefore||!Number.isFinite(row[y])){flush();out.push(row);column=null;continue;}if(next!==column){flush();column=next;}bucket.push(row);}flush();return out;
  }
  function extent(rows,x,y,start,end){let min=0,max=1;const a=Math.max(0,lower(rows,x,start)-1),b=Math.min(rows.length,lower(rows,x,end)+1);for(let i=a;i<b;i++){const v=rows[i][y];if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);}}return [min,max];}
  const spatial=new WeakMap();
  function segments(rows,rect){
    let index=spatial.get(rows);
    if(!index){const size=100,tiles=new Map();for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i];if(b.gap||b.breakBefore)continue;const segment={a,b,index:i};for(let x=Math.floor(Math.min(a.x,b.x)/size);x<=Math.floor(Math.max(a.x,b.x)/size);x++)for(let z=Math.floor(Math.min(a.z,b.z)/size);z<=Math.floor(Math.max(a.z,b.z)/size);z++){const key=x+','+z;if(!tiles.has(key))tiles.set(key,[]);tiles.get(key).push(segment);}}index={size,tiles};spatial.set(rows,index);}
    const found=new Set();for(let x=Math.floor(rect.xmin/index.size);x<=Math.floor(rect.xmax/index.size);x++)for(let z=Math.floor(rect.zmin/index.size);z<=Math.floor(rect.zmax/index.size);z++)for(const segment of index.tiles.get(x+','+z)||[])found.add(segment);return [...found].sort((a,b)=>a.index-b.index);
  }
  let previous=[],data=null;
  function mapData(laps){if(data&&laps.length===previous.length&&laps.every((l,i)=>l.rows===previous[i]))return data;previous=laps.map(l=>l.rows);const rows=laps.flatMap(l=>l.rows);let xmin=Infinity,xmax=-Infinity,zmin=Infinity,zmax=-Infinity;for(const r of rows){xmin=Math.min(xmin,r.x);xmax=Math.max(xmax,r.x);zmin=Math.min(zmin,r.z);zmax=Math.max(zmax,r.z);}return data={rows,xmin,xmax,zmin,zmax};}
  root.RaceRender={reduce,mapData,extent,segments};if(typeof module!=='undefined')module.exports=root.RaceRender;
})(globalThis);
