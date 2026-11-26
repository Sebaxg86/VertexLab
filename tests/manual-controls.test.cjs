const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('incoming telemetry cannot restart the manual confirmation closing animation',()=>{
 const classes=new Set(),timers=[];let closed=0;
 const dialog={open:true,classList:{contains:key=>classes.has(key),add:key=>classes.add(key),remove:key=>classes.delete(key)},close(){this.open=false;closed++;}};
 const context=vm.createContext({Map,$:()=>dialog,setTimeout:callback=>{timers.push(callback);return timers.length;},clearTimeout:()=>{},latest:{recording:'test-session'}});
 vm.runInContext(fs.readFileSync(require.resolve('../public/racing-ui.js'),'utf8'),context);
 context.closeManualRecordingDialog();
 for(let i=0;i<30;i++)context.closeManualRecordingDialog();
 assert.equal(timers.length,1);timers[0]();assert.equal(closed,1);assert.equal(dialog.open,false);
});
