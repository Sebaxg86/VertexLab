(function(root) {
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  function zoomRange(range, domain, anchor, factor) {
    const full = Math.max(.001,domain[1]-domain[0]);
    const old = range || {start:domain[0],end:domain[1]};
    const oldSpan = old.end-old.start;
    const span = clamp(oldSpan/factor,full/128,full);
    const fraction = clamp((anchor-old.start)/oldSpan,0,1);
    const start = clamp(anchor-fraction*span,domain[0],domain[1]-span);
    return {start,end:start+span};
  }
  function anchoredPan(pan, pointer, center, ratio) {
    return pan.map((value,i) => pointer[i]-center[i]-ratio*(pointer[i]-center[i]-value));
  }
  function followRange(range, domain, cursor) {
    if (!range) return null;
    const span = Math.min(domain[1]-domain[0],range.end-range.start);
    const start = clamp(cursor-span/2,domain[0],domain[1]-span);
    return {start,end:start+span};
  }
  root.RaceView = {zoomRange,anchoredPan,followRange};
  if (typeof module !== 'undefined') module.exports = root.RaceView;
})(globalThis);
