/* ============================================================================
   NCTH shared model + UI helpers — faithful to JA2 1.13 source
   (Weapons.cpp CalcNewChanceToHitGun / LOS.cpp AdjustTargetCenterPoint & recoil)
   ========================================================================== */
(function(){
const CELL=10, RAD=Math.PI/180;

// ---- default (vanilla) CTHConstants + external options in play ----
const DEFAULTS={
  DEG_APERTURE:15, NORMAL_DIST:70, IRON_PERF:20, IRON_GRAD:1, IRON_MOD:3, VERT_BIAS:0.5,
  SCOPE_EFF_MULT:1.1, SCOPE_EFF_MIN:50, LASER_IRON:15, LASER_HIP:25, LASER_SCOPE:10,
  BASE_EXP:3, BASE_MARKS:1, BASE_WIS:1, BASE_DEX:1, BASE_DRAW:2,
  BASE_STAND:2, BASE_CROUCH:3, BASE_PRONE:4,
  BASE_INJURY:-30, BASE_FATIGUE:-15, BASE_SHOCK:-150, BASE_HIMORALE:2, BASE_LOMORALE:-1, BASE_GASSED:-15,
  AIM_EXP:1, AIM_MARKS:3, AIM_WIS:1, AIM_DEX:2, AIM_DRAW:1,
  AIM_STAND:1.5, AIM_CROUCH:1.25, AIM_PRONE:1,
  AIM_INJURY:-60, AIM_FATIGUE:-40, AIM_SHOCK:-150, AIM_HIMORALE:1, AIM_LOMORALE:-2, AIM_GASSED:-80,
  MAX_CTH:99, MIN_CTH:0,
  MAX_BULLET_DEV:5, RANGE_EFFECTS_DEV:1, NORMAL_RECOIL_DIST:70,
  RC_MAX_STR:3, RC_MAX_AGI:1, RC_MAX_EXP:1, RC_MAX_FORCE:10, RC_MAX_CROUCH:10, RC_MAX_PRONE:25,
  RCA_DEX:3, RCA_WIS:1, RCA_AGI:1, RCA_EXP:4,
};
const BASE_DRUNK=[-5,-20,-50,-10];  // tipsy, drunk, wasted, hungover
const AIM_DRUNK=[-10,-40,-90,-15];
const MAX_SHOCK=30;

// ---- shared state (persisted to localStorage so tabs stay in sync) ----
const KEY='ncth-lab-v1';
function freshState(){
  return {
    exp:4, marks:70, dex:70, wis:70, agi:70, str:70,
    stance:'stand', diff:3, prog:0,
    handling:11, maxaim:6, sight:'iron', mag:4,
    tw:3.5, th:10,
    // conditions
    health:100, breath:100, morale:0, shock:0, drunk:0, gassed:0,
    // autofire
    bullets:6, gunRecoil:6,
    CUR:Object.assign({},DEFAULTS), PROP:Object.assign({},DEFAULTS),
  };
}
function load(){
  let s=freshState();
  try{ const j=JSON.parse(localStorage.getItem(KEY)); if(j){ Object.assign(s,j);
        s.CUR=Object.assign({},DEFAULTS,j.CUR||{}); s.PROP=Object.assign({},DEFAULTS,j.PROP||{}); } }catch(e){}
  return s;
}
function save(s){ try{ localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){} }

// ================= MODEL (faithful to source) =================
function baseAttr(s,C){
  const f=(C.BASE_EXP*s.exp*10 + C.BASE_MARKS*s.marks + C.BASE_DEX*s.dex + C.BASE_WIS*s.wis)
        /(C.BASE_EXP+C.BASE_MARKS+C.BASE_DEX+C.BASE_WIS);
  return f/3;
}
function capAttr(s,C){
  return (C.AIM_EXP*s.exp*10 + C.AIM_MARKS*s.marks + C.AIM_DEX*s.dex + C.AIM_WIS*s.wis)
        /(C.AIM_EXP+C.AIM_MARKS+C.AIM_DEX+C.AIM_WIS);
}
const stanceBase=(s,C)=> s.stance==='stand'?C.BASE_STAND : s.stance==='crouch'?C.BASE_CROUCH : C.BASE_PRONE;
const stanceAim =(s,C)=> s.stance==='stand'?C.AIM_STAND  : s.stance==='crouch'?C.AIM_CROUCH  : C.AIM_PRONE;
function playerDiff(s){ const v={1:20,2:10,3:0,4:0}[s.diff]||0; return Math.max(0,30-s.prog)*v/30; }

// condition -> additive % modifiers on base and aim (BaseEffectBonus / AimEffectBonus)
function condMods(s,C){
  let base=0, aim=0;
  // morale (per point vs 50); positive uses HI, negative uses LO
  if(s.morale>0){ base+=C.BASE_HIMORALE*s.morale; aim+=C.AIM_HIMORALE*s.morale; }
  else if(s.morale<0){ base+=C.BASE_LOMORALE*(-s.morale); aim+=C.AIM_LOMORALE*(-s.morale); }
  // injury (missing health, bleeding model)
  const missing=(100-s.health)/100;
  base+=C.BASE_INJURY*missing; aim+=C.AIM_INJURY*missing;
  // fatigue (missing breath)
  const tired=(100-s.breath)/100;
  base+=C.BASE_FATIGUE*tired; aim+=C.AIM_FATIGUE*tired;
  // suppression shock
  const shock=s.shock/MAX_SHOCK;
  base+=C.BASE_SHOCK*shock; aim+=C.AIM_SHOCK*shock;
  // drunk
  if(s.drunk>0){ base+=BASE_DRUNK[s.drunk-1]; aim+=AIM_DRUNK[s.drunk-1]; }
  // gassed
  if(s.gassed){ base+=C.BASE_GASSED; aim+=C.AIM_GASSED; }
  return {base,aim};
}

// displayed CTH at aim level t
function displayedCTH(s,C,t){
  let base=baseAttr(s,C);
  if(base<=C.MIN_CTH) return C.MIN_CTH;
  const cm=condMods(s,C);
  const baseMod=-(s.handling*stanceBase(s,C)*C.BASE_DRAW) + playerDiff(s) + cm.base;
  base=Math.max(0,Math.min(100, base*(100+baseMod)/100));
  if(t<=0) return Math.max(C.MIN_CTH, Math.min(base,C.MAX_CTH));
  let cap=Math.min(Math.max(capAttr(s,C), Math.max(0,base)), C.MAX_CTH);
  const aimMod=-(C.AIM_DRAW*s.handling*stanceAim(s,C)) + playerDiff(s) + cm.aim;
  let span=Math.max(0,(cap-base)*(100+aimMod)/100);
  const div=s.maxaim*(s.maxaim+1)/2, frac=span/div;
  let pts=0; for(let x=0;x<t;x++) pts+=frac*(s.maxaim-x);
  return Math.max(C.MIN_CTH, Math.min(Math.min(Math.max(base+pts,base),cap), C.MAX_CTH));
}

// scope effectiveness (CalcEffectiveMagFactor, no trait floors)
function effMag(s,C,mag){
  if(mag<=1) return 1;
  const maxEff=mag*C.SCOPE_EFF_MULT;
  const fixed=maxEff*C.SCOPE_EFF_MIN/100;
  const variable=maxEff*(100-C.SCOPE_EFF_MIN)/100*((s.exp*10*C.AIM_EXP + s.marks*C.AIM_MARKS)/(C.AIM_EXP+C.AIM_MARKS)/100);
  return Math.min(maxEff, Math.max(fixed+variable,0.1));
}
// aperture radius (units) at distance dUnits given muzzle sway 0..100
function aperture(dUnits,sway,C,s,sight,mag,grad){
  let basic=Math.sin(C.DEG_APERTURE*RAD)*C.NORMAL_DIST;
  const dTiles=dUnits/CELL;
  let m=1;
  if(sight==='scope'){ m=effMag(s,C,mag); }
  else { // iron
    if(grad) basic*=(1/Math.sqrt(dTiles)/C.IRON_MOD + (C.IRON_MOD-1)/C.IRON_MOD);
    basic*=(100-C.IRON_PERF)/100;
  }
  const dist=basic*(dUnits/C.NORMAL_DIST);
  return Math.max(0, dist/m*sway/100);
}
const vbias=(s,C)=> s.stance==='stand'?1 : s.stance==='prone'?C.VERT_BIAS : 1+(C.VERT_BIAS-1)*0.66;

// Monte-Carlo hit chance for an aimed shot; optional vertical center offset (recoil)
function hitProb(apR,C,s,offY,n){
  n=n||3000; offY=offY||0;
  if(apR<=0 && offY===0) return 1;
  const tw=s.tw, th=s.th, vb=vbias(s,C); let h=0;
  for(let i=0;i<n;i++){
    const r=Math.sqrt(Math.random()), a=Math.random()*2*Math.PI;
    const dx=Math.sin(a)*r*apR, dy=Math.cos(a)*r*apR*vb + offY;
    if((dx*dx)/(tw*tw)+(dy*dy)/(th*th)<=1) h++;
  }
  return h/n;
}
function realHit(s,C,dTiles,t,sight,mag,grad){
  const cth=displayedCTH(s,C,t), sway=100-cth;
  const apR=aperture(dTiles*CELL,sway,C,s,sight||s.sight,mag||s.mag,grad);
  return {cth,sway,apR,p:hitProb(apR,C,s)};
}

// ---- recoil (CalcCounterForceAccuracy / CalcCounterForceMax) ----
function cfAccuracy(s,C){ // 0..100 = how accurately recoil is countered
  const v=(C.RCA_DEX*s.dex + C.RCA_WIS*s.wis + C.RCA_AGI*s.agi + C.RCA_EXP*s.exp*10)
         /(C.RCA_DEX+C.RCA_WIS+C.RCA_AGI+C.RCA_EXP);
  return Math.max(0,Math.min(100,v));
}
function cfMax(s,C){
  let v=(C.RC_MAX_STR*s.str + C.RC_MAX_AGI*s.agi + C.RC_MAX_EXP*s.exp*10)/(C.RC_MAX_STR+C.RC_MAX_AGI+C.RC_MAX_EXP);
  v=v*C.RC_MAX_FORCE/100;
  if(s.stance==='crouch') v+=C.RC_MAX_CROUCH*C.RC_MAX_FORCE/100;
  if(s.stance==='prone')  v+=C.RC_MAX_PRONE*C.RC_MAX_FORCE/100;
  return v;
}
// conceptual per-bullet muzzle-walk for a burst/auto volley (teaching model)
function burst(s,C,dTiles,t,sight,mag,grad){
  const N=Math.max(1,s.bullets|0);
  const apR=aperture(dTiles*CELL,100-displayedCTH(s,C,t),C,s,sight||s.sight,mag||s.mag,grad);
  const acc=cfAccuracy(s,C)/100, max=cfMax(s,C);
  const dr=C.RANGE_EFFECTS_DEV? dTiles*CELL/C.NORMAL_RECOIL_DIST : 1;
  let offset=0; const rows=[];
  for(let i=1;i<=N;i++){
    if(i>1){
      offset+=s.gunRecoil;                       // recoil pushes muzzle up
      const applied=Math.min(max,offset)*acc;    // counter a fraction, capped by max force
      offset-=applied;
    }
    const offY=offset*dr;
    rows.push({i, offY, p:hitProb(apR,C,s,offY,1500)});
  }
  const avg=rows.reduce((a,r)=>a+r.p,0)/N;
  return {rows, avg, apR};
}

// =================== UI HELPERS ===================
function nav(active){
  const T=[['index.html','Accuracy'],['optics.html','Optics'],['conditions.html','Conditions'],
           ['autofire.html','Recoil & Autofire']];
  let t=T.map(([h,l])=>`<a href="${h}"${h===active?' class="on"':''}>${l}</a>`).join('');
  t+=`<a href="reference.html"${active==='reference.html'?' class="on ref"':' class="ref"'}>All parameters</a>`;
  t+=`<a href="report.html"${active==='report.html'?' class="on"':''}>Report</a>`;
  return `<div class="topnav"><div class="brand">JA2 1.13 · NCTH Tuning Lab <small>— faithful shot-by-shot model</small></div><nav class="tabs">${t}</nav></div>`;
}
// bind all [data-bind] inputs/selects and [data-seg] segmented controls to state
function bind(root, s, render){
  const setPath=(path,val)=>{ if(path.includes('.')){const[o,k]=path.split('.'); s[o][k]=val;} else s[path]=val; };
  const getPath=(path)=> path.includes('.')? s[path.split('.')[0]][path.split('.')[1]] : s[path];
  root.querySelectorAll('[data-bind]').forEach(el=>{
    const path=el.dataset.bind, cur=getPath(path);
    if(el.type==='range'||el.type==='number'){ el.value=cur; }
    else if(el.tagName==='SELECT'){ el.value=cur; }
    const out=el.parentElement.querySelector('.val');
    const fmt=el.dataset.fmt||'';
    const show=()=>{ if(out) out.textContent=el.value+(fmt); };
    show();
    el.addEventListener('input',()=>{ let v=el.value; if(el.type==='range'||el.type==='number') v=parseFloat(v);
      if(el.tagName==='SELECT' && !isNaN(v) && el.dataset.num) v=parseFloat(v);
      setPath(path, (el.tagName==='SELECT'&&!el.dataset.num)? el.value : v);
      show(); save(s); render(); });
  });
  root.querySelectorAll('[data-seg]').forEach(seg=>{
    const path=seg.dataset.seg;
    seg.querySelectorAll('button').forEach(b=>{
      if(String(getPath(path))===b.dataset.v) b.classList.add('on'); else b.classList.remove('on');
      b.addEventListener('click',()=>{ seg.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
        b.classList.add('on'); let v=b.dataset.v; if(!isNaN(v)&&seg.dataset.num) v=parseFloat(v);
        setPath(path, v); save(s); render(); });
    });
  });
}
// shared shooter card html
function shooterCard(opts){
  opts=opts||{};
  const extra = opts.extraStats ? `
      <div class="row"><label>Agility</label><span class="val"></span><input data-bind="agi" type="range" min="0" max="100" step="1"></div>
      <div class="row"><label>Strength</label><span class="val"></span><input data-bind="str" type="range" min="0" max="100" step="1"></div>`:'';
  return `<div class="card">
    <h2>The Shooter</h2>
    <div class="row"><label>Experience level</label><span class="val"></span><input data-bind="exp" type="range" min="1" max="10" step="1"></div>
    <div class="row"><label>Marksmanship</label><span class="val"></span><input data-bind="marks" type="range" min="0" max="100" step="1"></div>
    <div class="row"><label>Dexterity</label><span class="val"></span><input data-bind="dex" type="range" min="0" max="100" step="1"></div>
    <div class="row"><label>Wisdom</label><span class="val"></span><input data-bind="wis" type="range" min="0" max="100" step="1"></div>${extra}
    <div class="row"><label>Stance</label><div class="seg" data-seg="stance">
      <button data-v="stand">Stand</button><button data-v="crouch">Crouch</button><button data-v="prone">Prone</button></div></div>
    <div class="row"><label>Difficulty</label><select data-bind="diff" data-num>
      <option value="1">Novice</option><option value="2">Experienced</option><option value="3">Expert</option><option value="4">Insane</option></select></div>
    <div class="row"><label>Campaign progress %</label><span class="val"></span><input data-bind="prog" type="range" min="0" max="100" step="5"></div>
  </div>`;
}
// build a tuning card for a given list of CTHConstants keys (writes to PROP)
function tuningCard(title, defs){
  const rows=defs.map(d=>{
    if(d.seg) return `<div class="row"><label>${d.label}</label><div class="seg" data-seg="${d.bind}" ${d.num?'data-num':''}>${d.seg.map(o=>`<button data-v="${o[0]}">${o[1]}</button>`).join('')}</div></div>`;
    return `<div class="row"><label>${d.label}</label><span class="val"></span><input data-bind="${d.bind}" type="range" min="${d.min}" max="${d.max}" step="${d.step}"></div>`;
  }).join('');
  return `<div class="card"><h2>${title} <span class="propflag">(edit = PROPOSED)</span></h2>${rows}</div>`;
}
// canvas line chart
function lineChart(cv, o){
  const w=cv.parentElement.clientWidth-28; cv.width=w; cv.style.width=w+'px';
  const ctx=cv.getContext('2d'); const H=cv.height, L=40,R=12,T=10,B=28, pw=w-L-R, ph=H-T-B;
  const xmax=o.xmax, ymax=o.ymax||100, ystep=o.ystep||20;
  const X=v=>L+v/xmax*pw, Y=v=>T+ph-Math.min(v,ymax)/ymax*ph;
  ctx.clearRect(0,0,w,H); ctx.font='11px sans-serif';
  ctx.fillStyle='#93a1b5';
  for(let g=0;g<=ymax;g+=ystep){ ctx.strokeStyle='#222b3a'; ctx.beginPath(); ctx.moveTo(L,Y(g)); ctx.lineTo(w-R,Y(g)); ctx.stroke();
    ctx.fillText(g,4,Y(g)+3); }
  for(let g=0;g<=xmax;g+=o.xstep||5){ ctx.strokeStyle='#1c2431'; ctx.beginPath(); ctx.moveTo(X(g),T); ctx.lineTo(X(g),T+ph); ctx.stroke();
    ctx.fillText(g,X(g)-4,T+ph+14); }
  ctx.fillText(o.xlabel||'',L+pw/2-24,H-2);
  (o.series||[]).forEach(se=>{ ctx.save(); ctx.strokeStyle=se.color; ctx.lineWidth=se.w||2.4; if(se.dash) ctx.setLineDash(se.dash);
    ctx.beginPath(); se.data.forEach((p,i)=> i?ctx.lineTo(X(p[0]),Y(p[1])):ctx.moveTo(X(p[0]),Y(p[1]))); ctx.stroke(); ctx.restore(); });
}
function pill(v){ const c=v>=55?'p-good':v>=30?'p-warn':'p-bad'; return `<span class="pill ${c}">${Math.round(v)}%</span>`; }

// export
window.NCTH={ DEFAULTS, load, save, freshState,
  baseAttr, capAttr, condMods, displayedCTH, effMag, aperture, hitProb, realHit,
  cfAccuracy, cfMax, burst, vbias,
  nav, bind, shooterCard, tuningCard, lineChart, pill, CELL };
})();
