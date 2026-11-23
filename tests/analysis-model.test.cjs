const test=require('node:test');
const assert=require('node:assert/strict');
const {clock,bounds,sessionRows,atDistance,videoChoices}=require('../public/analysis-model.js');
const laps=[{id:0,rows:[{t:0,d:0},{t:10,d:100}]},{id:1,rows:[{t:10.02,d:0},{t:22,d:100}]}];
test('whole session retains session time and accumulates distance without changing saved rows',()=>{const rows=sessionRows(laps);assert.deepEqual(rows.map(r=>r.t),[0,10,10.02,22]);assert.deepEqual(rows.map(r=>r.d),[0,100,100,200]);assert.equal(rows[3].lapDistance,100);assert.equal(laps[1].rows[0].d,0);});
test('lap bounds constrain playback to recorded portion',()=>{assert.deepEqual(bounds(laps[1]),{start:10.02,end:22});assert.deepEqual(bounds(undefined),{start:0,end:0});});
test('comparison maps equal distance to different session video times',()=>{assert.equal(atDistance(laps[0],50),5);assert.equal(atDistance(laps[1],50),16.009999999999998);assert.equal(atDistance(laps[1],-1),null);assert.equal(atDistance(laps[1],101),null);});
test('comparison never interpolates missing coverage',()=>{assert.equal(atDistance({rows:[{t:0,d:0},{t:10,d:100,breakBefore:true}]},50),null);assert.equal(atDistance({rows:[{t:0,d:0},{t:10,d:100,gap:true}]},50),null);});
test('fifteen comparisons retain at most two stable valid video choices',()=>{const selected=new Set(Array.from({length:15},(_,i)=>i));assert.deepEqual(videoChoices(selected,[7,12]),[7,12]);selected.delete(7);assert.deepEqual(videoChoices(selected,[7,12]),[12,0]);assert.deepEqual(videoChoices(new Set([3]),[7,12]),[3]);});
test('lap clock handles millisecond rollover',()=>{assert.equal(clock(59.9996),'1:00.000');assert.equal(clock(106.589),'1:46.589');});
const {sampleAtTime}=require('../public/analysis-model.js');
test('smooth distance clocks keep measured readings and refuse telemetry gaps',()=>{const rows=[{t:10,d:0,speed:20},{t:12,d:100,speed:80}];const sample=sampleAtTime(rows,10.5);assert.equal(sample.d,25);assert.equal(sample.t,10.5);assert.equal(sample.speed,20);assert.equal(sampleAtTime(rows,9),null);assert.equal(sampleAtTime([{t:0,d:0},{t:1,d:10,gap:true}],.5),null);});
test('resume timestamp uses the newest sample, matching the newest OBS anchor',()=>{const rows=[{t:0,d:0,steer:0},{t:1,d:10,steer:-127},{t:1,d:10,steer:127,breakBefore:true},{t:2,d:20,steer:60}];assert.equal(sampleAtTime(rows,1).steer,127);assert.equal(sampleAtTime(rows,1.1).steer,127);assert.equal(sampleAtTime(rows,0).steer,0);assert.equal(sampleAtTime(rows,2).steer,60);});
const {fastestLapIds}=require('../public/analysis-model.js');
test('fastest lap excludes partial laps even if their recorded duration is shorter',()=>{const lap=(id,time,partial=false)=>({id,partial,rows:[{lapTime:0},{lapTime:time}]});assert.deepEqual(fastestLapIds([lap(0,12,true),lap(1,81),lap(2,78),lap(3,20,true)]),[2]);assert.deepEqual(fastestLapIds([lap(0,12,true)]),[]);assert.deepEqual(fastestLapIds([]),[]);});
test('equal complete lap times both receive the fastest distinction',()=>{const rows=[{lapTime:0},{lapTime:80.123}];assert.deepEqual(fastestLapIds([{id:1,rows},{id:2,rows}]),[1,2]);});

test('informational lap summaries compare complete laps to best and label partial coverage',()=>{const {lapSummary}=require('../public/analysis-model.js');const laps=[{id:0,number:0,partial:true,rows:[{t:0,lapTime:10},{t:12,lapTime:22}]},{id:1,number:1,partial:false,rows:[{t:12,lapTime:0},{t:72,lapTime:60}]},{id:2,number:2,partial:false,rows:[{t:72,lapTime:0},{t:134.5,lapTime:62.5}]}];const result=lapSummary(laps);assert.equal(result[0].delta,null);assert.equal(result[0].time,12);assert.equal(result[1].best,true);assert.equal(result[2].delta,2.5);assert.equal(result[2].best,false);assert.deepEqual(lapSummary([]),[]);});

test('whole-session colour series retain lap identity, boundary continuity and cached geometry',()=>{const {timeSeries}=require('../public/analysis-model.js');const rows=[{t:0,lapId:0,d:0},{t:1,lapId:0,d:10},{t:2,lapId:2,d:20},{t:3,lapId:2,d:30},{t:4,lapId:5,d:40,gap:true}];const series=timeSeries(rows);assert.deepEqual(series.map(s=>s.id),[0,2,5]);assert.equal(series[1].rows[0],rows[1]);assert.equal(series[1].rows[1],rows[2]);assert.deepEqual(series[2].rows,[rows[4]]);assert.equal(timeSeries(rows),series);assert.equal(rows.length,5);});
test('transport colour segments use actual session time and retain unrecorded gaps',()=>{const {lapTimeline}=require('../public/analysis-model.js');const segments=lapTimeline([{id:2,number:2,partial:false,rows:[{t:10},{t:50}]},{id:5,number:5,partial:true,rows:[{t:55},{t:80}]}],75);assert.deepEqual(segments,[{id:2,number:2,partial:false,start:10,end:50},{id:5,number:5,partial:true,start:55,end:75}]);assert.deepEqual(lapTimeline([],0),[]);});

test('session overview shares heavy telemetry arrays while preserving instrument readings',()=>{
 const model=require('../public/analysis-model.js'),temps=[80,81,82,83],slip=[.1,.2,.3,.4];
 const original={t:0,d:0,rpm:6000,speed:100,throttle:80,brake:0,tireTemp:temps,tireSlipRatio:slip,steer:45};
 const rows=model.sessionRows([{id:0,rows:[original,{...original,t:1,d:100}]}]);
 assert.equal(rows[0].source,original);assert.equal(Object.hasOwn(rows[0],'tireTemp'),false);
 const sample=model.instrumentSample(model.sampleAtTime(rows,.5));assert.equal(sample.tireTemp,temps);assert.equal(sample.tireSlipRatio,slip);assert.equal(sample.steer,45);assert.equal(sample.d,50);assert.equal(sample.rpm,6000);
});
