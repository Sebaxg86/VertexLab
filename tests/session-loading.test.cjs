const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
function harness(){
  const timers=new Map();let next=0,now=0;
  function element(id){const classes=new Set();return {id,tagName:'DIV',hidden:false,inert:false,isConnected:true,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},setAttribute(){},removeAttribute(){},closest(){return null;},focus(){doc.activeElement=this;}};}
  const nodes=Object.fromEntries(['session-loading','workspace','session-trigger'].map(id=>[id,element(id)]));
  const doc={body:element('body'),activeElement:nodes['session-trigger']};doc.body.children=Object.values(nodes);
  const context=vm.createContext({document:doc,$:id=>nodes[id],performance:{now:()=>now},requestAnimationFrame:fn=>fn(),setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(fs.readFileSync(require.resolve('../public/view-ui.js'),'utf8'),context);
  return {nodes,start:()=>vm.runInContext('startSessionLoading()',context),advance:()=>{now+=1000;},exit:()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}}};
}
test('session loader releases the background after successful or failed work',async()=>{
  const h=harness(),finish=h.start();assert.equal(h.nodes.workspace.inert,true);assert.equal(h.nodes['session-loading'].hidden,false);
  h.advance();try{throw Error('failed session');}catch{}finally{await finish();}h.exit();
  assert.equal(h.nodes.workspace.inert,false);assert.equal(h.nodes['session-loading'].hidden,true);
});
test('a new load during the exit animation preserves original background interaction state',async()=>{
  const h=harness(),first=h.start();h.advance();await first();
  const second=h.start();h.advance();await second();h.exit();
  assert.equal(h.nodes.workspace.inert,false);assert.equal(h.nodes['session-trigger'].inert,false);assert.equal(h.nodes['session-loading'].hidden,true);
});
test('overlapping loads keep the loading screen until both complete',async()=>{
  const h=harness(),first=h.start(),second=h.start();h.advance();await first();h.exit();
  assert.equal(h.nodes['session-loading'].hidden,false);assert.equal(h.nodes.workspace.inert,true);
  await second();h.exit();assert.equal(h.nodes['session-loading'].hidden,true);assert.equal(h.nodes.workspace.inert,false);
});
