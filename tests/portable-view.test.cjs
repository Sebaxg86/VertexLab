const test=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('../public/portable-view.js');
const laps=[{id:0,rows:[{t:0,d:0},{t:60,d:1000}]},{id:1,rows:[{t:60,d:0},{t:119,d:1000}]},{id:2,rows:[{t:119,d:0},{t:180,d:1000}]}];
test('portable comparison restores the same reference, two videos, cursor and zoom',()=>{
 const state={version:1,allMode:false,selected:[1,2],reference:2,t:150,videoChoices:[2,1],chartRange:{start:100,end:500},zoom:16,panNormalized:[.2,-.4],expandedMetric:'speed',metricIndex:1,rate:2,volume:.7,muted:true};
 assert.deepEqual(normalize(state,laps,['speed','rpm','throttle']),state);
});
test('untrusted view state cannot introduce unavailable laps or invalid dimensions',()=>{
 const view=normalize({allMode:false,selected:[99],reference:99,t:Infinity,zoom:-1,panNormalized:[NaN,Infinity],rate:100,volume:3,expandedMetric:'<script>',chartRange:{start:-3,end:Infinity}},laps,['speed','rpm']);
 assert.equal(view.allMode,true);assert.deepEqual(view.selected,[0,1,2]);assert.equal(view.reference,0);assert.equal(view.t,0);assert.equal(view.zoom,.2);assert.deepEqual(view.panNormalized,[0,0]);assert.equal(view.rate,1);assert.equal(view.volume,1);assert.equal(view.expandedMetric,null);assert.equal(view.chartRange,null);
});
