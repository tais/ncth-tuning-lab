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
  SCOPE_RANGE_MULT:0.7, AIM_TOO_CLOSE:-4, AIM_TOO_CLOSE_THRESH:0.8,
  BASE_EXP:3, BASE_MARKS:1, BASE_WIS:1, BASE_DEX:1, BASE_DRAW:2,
  BASE_STAND:2, BASE_CROUCH:3, BASE_PRONE:4,
  BASE_INJURY:-30, BASE_FATIGUE:-15, BASE_SHOCK:-150, BASE_HIMORALE:2, BASE_LOMORALE:-1, BASE_GASSED:-15,
  AIM_EXP:1, AIM_MARKS:3, AIM_WIS:1, AIM_DEX:2, AIM_DRAW:1,
  AIM_STAND:1.5, AIM_CROUCH:1.25, AIM_PRONE:1,
  AIM_INJURY:-60, AIM_FATIGUE:-40, AIM_SHOCK:-150, AIM_HIMORALE:1, AIM_LOMORALE:-2, AIM_GASSED:-80,
  AIM_VISIBILITY:-1, AIM_TARGET_INVISIBLE:-50,
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
    stance:'stand', diff:3, prog:0, xmax:40,
    handling:11, maxaim:6, sight:'iron', mag:4,
    tw:3.5, th:10,
    // gun deviation / visibility / laser
    acc:63, effRange:330, bulletdev:0, vis:100, laser:0, laserRange:10, dark:40,
    // attachments
    att:{bipod:0, foregrip:0, match:0, extender:0},
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
  // repair any toggle values stored as strings by an earlier build ("0" is truthy!)
  const numify=o=>{ if(o) for(const k in o) if(typeof o[k]==='string' && o[k]!=='' && !isNaN(o[k])) o[k]=parseFloat(o[k]); };
  numify(s); numify(s.att); numify(s.CUR); numify(s.PROP);
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
// attachment effects (values from Items.xml: bipod +100% CF-max/+35% CF-acc/+20% handling, foregrip +70/+30/-10%)
const A=s=>s.att||{};
const effStance=(s)=> A(s).bipod?'prone':s.stance;   // bipod = weapon resting => prone boni
const effHandling=(s)=> s.handling*(1 + ((A(s).bipod?20:0)+(A(s).foregrip?-10:0))/100);
const stanceBase=(s,C)=> {const st=effStance(s); return st==='stand'?C.BASE_STAND : st==='crouch'?C.BASE_CROUCH : C.BASE_PRONE;};
const stanceAim =(s,C)=> {const st=effStance(s); return st==='stand'?C.AIM_STAND  : st==='crouch'?C.AIM_CROUCH  : C.AIM_PRONE;};
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

// displayed CTH at aim level t. opts:{dTiles,sight,mag} enable the scope too-close penalty
function displayedCTH(s,C,t,opts){
  opts=opts||{};
  let base=baseAttr(s,C);
  if(base<=C.MIN_CTH) return C.MIN_CTH;
  const cm=condMods(s,C), hnd=effHandling(s);
  const baseMod=-(hnd*stanceBase(s,C)*C.BASE_DRAW) + playerDiff(s) + cm.base;
  base=Math.max(0,Math.min(100, base*(100+baseMod)/100));
  if(t<=0) return Math.max(C.MIN_CTH, Math.min(base,C.MAX_CTH));
  let cap=Math.min(Math.max(capAttr(s,C), Math.max(0,base)), C.MAX_CTH);
  let aimMod=-(C.AIM_DRAW*hnd*stanceAim(s,C)) + playerDiff(s) + cm.aim;
  // scope "too close" aim penalty (Weapons.cpp:6552) — a scope below its min range hurts aiming
  const sight=opts.sight||s.sight, mag=(opts.mag!==undefined?opts.mag:s.mag), dT=opts.dTiles;
  if(sight==='scope' && mag>1 && dT){
    const rangeU=dT*CELL, best=mag*C.NORMAL_DIST*C.SCOPE_RANGE_MULT;
    if(rangeU < best*C.AIM_TOO_CLOSE_THRESH)
      aimMod += (best*C.AIM_TOO_CLOSE_THRESH/rangeU) * C.AIM_TOO_CLOSE * (mag/2);
  }
  // visibility (cover / low light): AIM_VISIBILITY penalty, floored at AIM_TARGET_INVISIBLE (Weapons.cpp:6541)
  if(s.vis!==undefined && s.vis<100){
    aimMod += (100 - s.vis) * C.AIM_VISIBILITY / 100;
    aimMod = Math.max(C.AIM_TARGET_INVISIBLE, aimMod);
  }
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
  if(sight==='scope'){ m=scopeEffMag(s,C,mag,dTiles); }   // range-clamped + skill-gated
  else { // iron
    if(grad) basic*=(1/Math.sqrt(dTiles)/C.IRON_MOD + (C.IRON_MOD-1)/C.IRON_MOD);
    basic*=(100-C.IRON_PERF)/100;
  }
  const dist=basic*(dUnits/C.NORMAL_DIST);
  return Math.max(0, dist/m*sway/100);
}
// effective scope magnification AT a given range: min(scopeMag, (range/NORMAL)/rangeMult) then skill-gated
function scopeEffMag(s,C,mag,dTiles){
  if(mag<=1) return 1;
  const tmf=Math.max(1,(dTiles*CELL/C.NORMAL_DIST)/C.SCOPE_RANGE_MULT);
  return effMag(s,C,Math.min(mag,tmf));
}
// range (tiles) at which a scope first reaches full magnification
function scopeMinRange(C,mag){ return mag*C.NORMAL_DIST*C.SCOPE_RANGE_MULT/CELL; }
const vbias=(s,C)=> {const st=effStance(s); return st==='stand'?1 : st==='prone'?C.VERT_BIAS : 1+(C.VERT_BIAS-1)*0.66;};

// gun bullet-deviation radius (2nd scatter layer, absent from displayed CTH). CalcBulletDeviation, LOS.cpp:9541
function bulletDevRadius(s,C,dUnits){
  if(!s.bulletdev) return 0;
  const acc=Math.min(100, s.acc*(1+(A(s).match?10:0)/100)); // match ammo: PercentAccuracyModifier=10
  const effR=(s.effRange||1)*(A(s).extender?1.25:1);        // barrel extender adds effective range
  let dev=C.MAX_BULLET_DEV*(100-acc)/100;
  // C++ computes uiRange/sEffRange with INTEGER division (LOS.cpp:9582): ratio steps 1,2,3… at 1x,2x,3x eff-range
  if(C.RANGE_EFFECTS_DEV) dev*=Math.max(1, Math.floor(dUnits/effR));
  dev/=2;                       // CellXY/ScreenXY compensation
  dev*=dUnits/C.NORMAL_DIST;    // iDistanceRatio
  return Math.max(0,dev);
}
// Monte-Carlo hit chance; offY = vertical center offset (recoil); devR = gun bullet-deviation radius
function hitProb(apR,C,s,offY,n,devR){
  n=n||3000; offY=offY||0; devR=devR||0;
  if(apR<=0 && offY===0 && devR<=0) return 1;
  const tw=s.tw, th=s.th, vb=vbias(s,C); let h=0;
  for(let i=0;i<n;i++){
    const r=Math.sqrt(Math.random()), a=Math.random()*2*Math.PI;
    let dx=Math.sin(a)*r*apR, dy=Math.cos(a)*r*apR*vb + offY;
    if(devR>0){ const r2=Math.random()*devR, a2=Math.random()*2*Math.PI;  // uniform-in-radius (no sqrt), per source
      dx+=Math.sin(a2)*r2; dy+=Math.cos(a2)*r2; }
    if((dx*dx)/(tw*tw)+(dy*dy)/(th*th)<=1) h++;
  }
  return h/n;
}
function realHit(s,C,dTiles,t,sight,mag,grad){
  sight=sight||s.sight; mag=mag||s.mag;
  const dU=dTiles*CELL;
  const cth=displayedCTH(s,C,t,{dTiles,sight,mag}), sway=100-cth;
  const apR=aperture(dU,sway,C,s,sight,mag,grad);
  const devR=bulletDevRadius(s,C,dU);
  return {cth,sway,apR,devR,p:hitProb(apR,C,s,0,3000,devR)};
}

// ---- recoil (CalcCounterForceAccuracy / CalcCounterForceMax) ----
function cfAccuracy(s,C){ // 0..100 = how accurately recoil is countered
  let v=(C.RCA_DEX*s.dex + C.RCA_WIS*s.wis + C.RCA_AGI*s.agi + C.RCA_EXP*s.exp*10)
         /(C.RCA_DEX+C.RCA_WIS+C.RCA_AGI+C.RCA_EXP);
  v*=1 + ((A(s).bipod?35:0)+(A(s).foregrip?30:0))/100;   // PercentCounterForceAccuracy
  return Math.max(0,Math.min(100,v));
}
function cfMax(s,C){
  let v=(C.RC_MAX_STR*s.str + C.RC_MAX_AGI*s.agi + C.RC_MAX_EXP*s.exp*10)/(C.RC_MAX_STR+C.RC_MAX_AGI+C.RC_MAX_EXP);
  // C++ pools stance + attachment percentages into ONE modifier, applied once (Items.cpp:10759-65, LOS.cpp:9830),
  // then scales by RECOIL_MAX_COUNTER_FORCE last
  const st=effStance(s);
  let mod=(A(s).bipod?100:0)+(A(s).foregrip?70:0);        // PercentMaxCounterForce
  if(st==='crouch') mod+=C.RC_MAX_CROUCH;
  if(st==='prone')  mod+=C.RC_MAX_PRONE;
  v+=v*mod/100;
  return v*C.RC_MAX_FORCE/100;
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
           ['autofire.html','Recoil & Autofire'],['weapons.html','Weapons'],['compare.html','Compare']];
  let t=T.map(([h,l])=>`<a href="${h}"${h===active?' class="on"':''}>${l}</a>`).join('');
  t+=`<a href="reference.html"${active==='reference.html'?' class="on ref"':' class="ref"'}>All parameters</a>`;
  t+=`<a href="report.html"${active==='report.html'?' class="on"':''}>Report</a>`;
  t+=`<span class="unitseg" title="1 tile = 10 m (per CTHConstants.ini)">`+
     ['tiles','m','yd'].map(u=>`<button data-unit="${u}"${UNITS===u?' class="on"':''}>${u}</button>`).join('')+`</span>`;
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
    const show=()=>{ if(out) out.textContent=('dist' in el.dataset)?fmtDist(parseFloat(el.value)):el.value+(fmt); };
    show();
    const num=('num' in el.dataset);   // valueless data-num => dataset.num==='' (falsy), so test presence
    el.addEventListener('input',()=>{ let v=el.value; if(el.type==='range'||el.type==='number') v=parseFloat(v);
      if(el.tagName==='SELECT' && !isNaN(v) && num) v=parseFloat(v);
      setPath(path, (el.tagName==='SELECT'&&!num)? el.value : v);
      show(); save(s); render(); });
    const ik=infoKeyFor(path), lab=el.parentElement.querySelector('label');
    if(ik&&lab&&!lab.querySelector('.ib')) lab.insertAdjacentHTML('beforeend',infoBtn(ik));
  });
  root.querySelectorAll('[data-seg]').forEach(seg=>{
    const path=seg.dataset.seg, num=('num' in seg.dataset);
    { const ik=infoKeyFor(path), lab=seg.parentElement.querySelector('label');
      if(ik&&lab&&!lab.querySelector('.ib')) lab.insertAdjacentHTML('beforeend',infoBtn(ik)); }
    seg.querySelectorAll('button').forEach(b=>{
      if(String(getPath(path))===b.dataset.v) b.classList.add('on'); else b.classList.remove('on');
      b.addEventListener('click',()=>{ seg.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
        b.classList.add('on'); let v=b.dataset.v; if(!isNaN(v)&&num) v=parseFloat(v);
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
// ---- shared hover tooltip ----
let _tip=null;
function tip(cx,cy,html){
  if(typeof document==='undefined'||!document.body) return;
  if(!_tip){ _tip=document.createElement('div'); _tip.id='ncth-tip'; document.body.appendChild(_tip); }
  _tip.innerHTML=html; _tip.style.display='block';
  const pad=14, vw=window.innerWidth||1200, vh=window.innerHeight||800;
  const bw=_tip.offsetWidth, bh=_tip.offsetHeight;
  let x=cx+pad, y=cy+pad;
  if(x+bw>vw-8) x=cx-bw-pad;
  if(y+bh>vh-8) y=cy-bh-pad;
  _tip.style.left=x+'px'; _tip.style.top=y+'px';
}
function hideTip(){ if(_tip) _tip.style.display='none'; }

// ---- distance units: the game defines 1 tile = 10 meters (CTHConstants.ini "measured in METERS ... 100 means 10 tiles")
const UNITKEY='ncth-units';
let UNITS='tiles';
try{ UNITS=localStorage.getItem(UNITKEY)||'tiles'; }catch(e){}
function setUnits(u){ UNITS=u; try{ localStorage.setItem(UNITKEY,u); }catch(e){} }
function distVal(tiles){ return UNITS==='m'? tiles*10 : UNITS==='yd'? tiles*10.936 : tiles; }
function fmtDist(tiles,dec){ const v=distVal(tiles); const d=dec!==undefined?dec:(UNITS==='tiles'?0:0);
  return v.toFixed(d)+(UNITS==='tiles'?' tiles':UNITS==='m'?' m':' yd'); }
function distAxisLabel(){ return 'range ('+(UNITS==='tiles'?'tiles':UNITS)+')'; }
// wire the nav unit switch once via delegation; changing units reloads (all state persists)
if(typeof document!=='undefined'&&document.addEventListener){
  document.addEventListener('click',e=>{ const b=e.target&&e.target.closest&&e.target.closest('[data-unit]');
    if(b){ setUnits(b.dataset.unit); location.reload(); } });
}

// canvas line chart (hover: vertical guide + per-series value labels)
function lineChart(cv, o){
  const w=cv.parentElement.clientWidth-28; cv.width=w; cv.style.width=w+'px';
  const H=cv.height, L=40,R=12,T=10,B=28, pw=w-L-R, ph=H-T-B;
  const xmax=o.xmax, ymax=o.ymax||100, ystep=o.ystep||20;
  const X=v=>L+v/xmax*pw, Y=v=>T+ph-Math.min(v,ymax)/ymax*ph;
  const draw=()=>{
    const ctx=cv.getContext('2d');
    ctx.clearRect(0,0,w,H); ctx.font='11px sans-serif';
    for(let g=0;g<=ymax;g+=ystep){ ctx.strokeStyle='#222b3a'; ctx.beginPath(); ctx.moveTo(L,Y(g)); ctx.lineTo(w-R,Y(g)); ctx.stroke();
      ctx.fillStyle='#93a1b5'; ctx.fillText(g,4,Y(g)+3); }
    for(let g=0;g<=xmax;g+=o.xstep||5){ ctx.strokeStyle='#1c2431'; ctx.beginPath(); ctx.moveTo(X(g),T); ctx.lineTo(X(g),T+ph); ctx.stroke();
      ctx.fillText(o.xdist?Math.round(distVal(g)):g,X(g)-4,T+ph+14); }
    ctx.fillText(o.xdist?distAxisLabel():(o.xlabel||''),L+pw/2-24,H-2);
    (o.series||[]).forEach(se=>{ ctx.save(); ctx.strokeStyle=se.color; ctx.lineWidth=se.w||2.4; if(se.dash) ctx.setLineDash(se.dash);
      ctx.beginPath(); se.data.forEach((p,i)=> i?ctx.lineTo(X(p[0]),Y(p[1])):ctx.moveTo(X(p[0]),Y(p[1]))); ctx.stroke(); ctx.restore(); });
  };
  draw();
  cv._chart={o,draw,X,Y,L,T,pw,ph,xmax};
  if(!cv._tipWired){ cv._tipWired=true;
    cv.addEventListener('mousemove',e=>{
      const c=cv._chart; if(!c) return;
      const r=cv.getBoundingClientRect(); if(!r||!r.width) return;
      const mx=(e.clientX-r.left)*(cv.width/r.width);
      const ref=(c.o.series||[]).find(se=>!se.noTip && se.data.length); if(!ref) return;
      const xv=(mx-c.L)/c.pw*c.xmax;
      let xn=ref.data[0][0], best=1e9;
      ref.data.forEach(p=>{ const d=Math.abs(p[0]-xv); if(d<best){best=d;xn=p[0];} });
      c.draw();
      const ctx=cv.getContext('2d');
      ctx.strokeStyle='rgba(255,255,255,.20)'; ctx.beginPath(); ctx.moveTo(c.X(xn),c.T); ctx.lineTo(c.X(xn),c.T+c.ph); ctx.stroke();
      const dec=c.o.dec!==undefined?c.o.dec:0, unit=c.o.unit!==undefined?c.o.unit:'%';
      let html=c.o.xdist?`<b>${fmtDist(xn)}</b>`:`<b>${c.o.xlabel||'x'}: ${xn}</b>`;
      (c.o.series||[]).forEach(se=>{ if(se.noTip||!se.data.length) return;
        let pt=se.data[0], bd=1e9; se.data.forEach(p=>{const d=Math.abs(p[0]-xn); if(d<bd){bd=d;pt=p;}});
        ctx.fillStyle=se.color; ctx.beginPath(); ctx.arc(c.X(pt[0]),c.Y(pt[1]),3.2,0,7); ctx.fill();
        html+=`<br><span style="color:${se.color}">●</span> ${se.name}: <b>${pt[1].toFixed(dec)}${unit}</b>`; });
      tip(e.clientX,e.clientY,html);
    });
    cv.addEventListener('mouseleave',()=>{ hideTip(); if(cv._chart) cv._chart.draw(); });
  }
}
function pill(v){ const c=v>=55?'p-good':v>=30?'p-warn':'p-bad'; return `<span class="pill ${c}">${Math.round(v)}%</span>`; }

// =================== INFO BUTTONS + MODAL ===================
const THREAD='https://thepit.ja-galaxy-forum.com/index.php?t=msg&th=16717&start=0&';
// Design-intent notes by Headrock (sole author of NCTH), from "New Chance To Hit system — The Formula" (Bear's Pit, 2010).
// Note: some numeric defaults evolved after 2010; the intent stands.
const HR={
 DEGREES_MAXIMUM_APERTURE:'The maximum bullet-deviation cone. Lowering the angle gives a tighter spread for everyone, regardless of skill.',
 NORMAL_SHOOTING_DISTANCE:'The optimal-range reference for optics: a 2× scope performs best at twice this distance, a 10× scope at ten times it.',
 BASE_EXP:'Experience dominates the snap-shot. It is much less important for aimed fire — that is what marksmanship is for.',
 BASE_MARKS:'The average merc should have around 15–20 base CTH unaimed; base CTH is deliberately low — it represents uncontrolled fire.',
 AIM_MARKS:'Marksmanship is the primary skill for deliberate aim; precision correlates to training.',
 AIM_DEX:'Stability matters when aiming — weapon steadiness relies on physical control.',
 AIM_EXP:'Experience, which played a major role in Base CTH, is now much less important when aiming precisely.',
 BASE_PSYCHO:'I personally don’t think psychos should be MORE accurate than anyone else — they’re more likely to shoot more bullets randomly at the target.',
 AIM_PSYCHO:'Lack of focus worsens deliberate aim even more than reflexive fire.',
 BASE_SAME_TARGET:'The shooter learns the target’s location — the bonus applies if the shooter kept aiming and the target hasn’t moved.',
 BASE_INJURY:'Bleeding injuries penalize proportionally to max health; bandaged damage is only a third as severe.',
 AIM_INJURY:'Roughly double the base penalty — wounds cripple deliberate aim.',
 BASE_FATIGUE:'Applied against breath percentage: half the penalty at 50% breath.',
 AIM_FATIGUE:'Holding a weapon steady takes stamina; fatigue hits aiming too.',
 BASE_GASSED:'Gas obscures vision and ruins accuracy.',
 AIM_GASSED:'Aiming through gas is even worse than snap-shooting through it.',
 BASE_SHOCK:'The maximum suppression penalty is only achievable by complete noobs under heavy fire — experienced mercs stop accumulating shock much earlier.',
 AIM_SHOCK:'Suppression cripples focused aiming just as hard.',
 BASE_SHOOTING_UPWARDS:'Divided by range — shooting upward is awkward up close but negligible at distance.',
 BASE_TARGET_INVISIBLE:'You cannot snap-shoot what you cannot see: base CTH drops to nearly zero.',
 AIM_TARGET_INVISIBLE:'Snipers suffer much less of this penalty and can hit targets they can’t see, based solely on a spotter’s line of sight.',
 BASE_STANDING_STANCE:'For quick fire you want to stand up, and for aimed fire you want to get down.',
 AIM_STANDING_STANCE:'Standing is penalized when aiming — it’s unstable; prone is steadiest.',
 BASE_DRAW_COST:'Gun Handling equals the AP cost to ready the gun — heavy, cumbersome weapons pay for it in accuracy.',
 AIM_DRAW_COST:'Aiming is slightly less penalized by gun size and weight than snap fire.',
 AIM_TOO_CLOSE_SCOPE:'A gun with a scope mounted on top is harder to aim properly when the target is too close — it’s probably better to spend the APs to remove the scope.',
 MOVEMENT_TRACKING_DIFFICULTY:'A character with 50 combined skill suffers the movement penalty for any target moving up to ~10 tiles a turn; skilled shooters start compensating sooner.',
 MOVEMENT_PENALTY_PER_TILE:'The penalty accumulates per tile moved, then skilled compensation claws it back at half rate beyond the threshold.',
};
// Info entries for the non-INI controls (grounded in the current source)
const INFO={
 exp:{t:'Experience level',h:'<p>The dominant stat for <b>Base CTH</b> (snap shots): the formula multiplies it by 10 <i>and</i> weights it ×3, so with vanilla weights one experience level is worth ~30 marksmanship points to the unaimed shot. It matters far less for the aimed cap (weight 1).</p>',hr:'Experience dominates the snap-shot. It is much less important for aimed fire.'},
 marks:{t:'Marksmanship',h:'<p>The dominant stat for the <b>CTH cap</b> — the ceiling aiming can reach (weight 3, vs experience 1). A high-marks recruit has a good ceiling but still a poor unaimed floor. Marksmanship 0 makes the shooter unable to hit at all (hard gate in the source).</p>',hr:'Marksmanship is the primary skill for deliberate aim; precision correlates to training.'},
 dex:{t:'Dexterity',h:'<p>Second-strongest cap stat (weight 2) — a steady hand raises how far aiming can take you. Dexterity 0 = never hits (hard gate). Also weighs into recoil-counter accuracy on full-auto.</p>'},
 wis:{t:'Wisdom',h:'<p>Weight 1 in both the base and the cap — a mild general contributor. Also helps track moving targets and time recoil corrections.</p>'},
 agi:{t:'Agility',h:'<p>Used by the recoil system: contributes to how much counter-force you can apply (weight 1) and how often/accurately you correct during a burst (frequency weight 3).</p>'},
 str:{t:'Strength',h:'<p>The main recoil-taming stat: weight 3 in <code>CalcCounterForceMax</code> — how much force the shooter can exert against muzzle climb during burst/auto fire. Irrelevant to single aimed shots.</p>'},
 stance:{t:'Shooter stance',h:'<p>Stance multiplies the gun-handling penalty differently for the two halves: standing ×2 base / ×1.5 aim; crouch ×3 / ×1.25; prone ×4 / ×1.0. So standing is best for snap shots, prone for aimed shots. Prone (or a rested bipod) also flattens the cone vertically via <code>VERTICAL_BIAS</code>, and lower stances add recoil counter-force.</p>',hr:'For quick fire you want to stand up, and for aimed fire you want to get down.'},
 diff:{t:'Game difficulty',h:'<p>Difficulty applies asymmetric CTH modifiers from <code>DifficultySettings.xml</code>: the <b>player</b> gets +20 (Novice) / +10 (Experienced) / 0 (Expert &amp; Insane), fading out by 30% campaign progress; <b>enemies</b> get −30 / 0 / +20 / +50 that never fades.</p>',hr:'Enemy AI cheats at higher difficulties — a relic from the old CTH system, preserved as adjustable coefficients.'},
 prog:{t:'Campaign progress',h:'<p>The player’s difficulty CTH bonus fades linearly and hits zero at 30% campaign progress: <code>max(0, 30 − progress) × bonus / 30</code>. An early-game crutch that removes itself.</p>'},
 handling:{t:'Weapon handling',h:'<p>The gun’s Handling stat (≈ AP cost to ready it; pistols ~9, assault rifles ~11, LMGs ~13). It feeds the biggest base-CTH penalty: <code>−handling × stance × BASE_DRAW_COST</code> — e.g. a standing rifle loses 44% of its base CTH at vanilla values.</p>',hr:'Gun Handling equals the AP cost to ready the gun — heavy, cumbersome weapons pay for it in accuracy.'},
 maxaim:{t:'Max aim clicks',h:'<p>How many aiming levels the gun allows. Each click adds a diminishing slice of the (cap − base) span: with N clicks the first gives N/(N(N+1)/2) of it, the last just 1 slice. Spending all clicks reaches the cap exactly.</p>',hr:'The first aiming level gives 8 of these fractions (8/36), the second 7 (7/36)… the system becomes self-contained.'},
 sight:{t:'Sight type',h:'<p>Iron sights get <code>IRON_SIGHT_PERFORMANCE_BONUS</code> and the distance gradient — always fully effective. Scopes divide the cone by their magnification, but only beyond their minimum range, skill-gated by <code>SCOPE_EFFECTIVENESS_*</code>.</p>'},
 mag:{t:'Scope magnification',h:'<p>A scope’s effective power is clamped by range: <code>min(mag, (range/NORMAL_SHOOTING_DISTANCE)/SCOPE_RANGE_MULTIPLIER)</code> — a 4× reaches full power at ~20 tiles, a 10× at ~49. Below ~80% of that range it also takes an aiming penalty. Low-skill shooters only unlock part of the magnification.</p>',hr:'A shot with a 10× scope at 10 tiles is actually harder than with a 2× at 10 tiles.'},
 xmax:{t:'Chart max range',h:'<p>Display-only: how far the charts plot. Big scopes need long ranges to shine — a 10× scope reaches full magnification only at ~49 tiles (~490 m).</p>'},
 tw:{t:'Target half-width',h:'<p>Half the silhouette’s width in map units (1 tile = 10 units = 10 m). The engine models bodies as stacks of 2-unit-wide "cubes" (JSD structures); a man is ~3 cubes wide from the front.</p>'},
 th:{t:'Target half-height',h:'<p>Half the silhouette’s height in units. Standing ≈ 3 cubes (~19 units tall); crouching 2; prone just 1 — which is why prone targets are so hard to hit.</p>'},
 targetstance:{t:'Target stance presets',h:'<p>Sets the silhouette to the engine’s JSD proportions: Standing 3×9 (half-extents), Crouched 3×6, Prone 3.5×3, Head-only 1.5×2. A prone target exposes roughly a third of a standing one.</p>'},
 health:{t:'Health',h:'<p>Injury penalizes both halves: up to <code>BASE_INJURY</code> (−30%) and <code>AIM_INJURY</code> (−60%) at 0 health, linear in missing health. The slider treats all damage as fresh/bleeding — bandaged damage counts only a third as much in the engine.</p>',hr:'Bleeding injuries penalize proportionally to max health; bandaged damage is only a third as severe.'},
 breath:{t:'Breath / stamina',h:'<p>Fatigue costs up to <code>BASE_FATIGUE</code> (−15%) and <code>AIM_FATIGUE</code> (−40%) at zero breath, linear. Tired mercs aim much worse than they snap-shoot.</p>',hr:'Holding a weapon steady takes stamina; fatigue hits aiming too.'},
 morale:{t:'Morale modifier',h:'<p>The engine’s <code>GetMoraleModifier</code> output: up to <b>+5</b> at 95+ morale, down to <b>−20</b> at 0. Each point is multiplied by the BASE/AIM morale coefficients (+2/−1 base, +1/−2 aim per point).</p>'},
 shock:{t:'Suppression shock',h:'<p>Suppression points (0–30). At max shock the penalties are <code>BASE_SHOCK</code>/<code>AIM_SHOCK</code> = −150% — total helplessness. Low-experience mercs accumulate shock fastest, which compounds the low-level accuracy problem under fire.</p>',hr:'The maximum penalty is only achievable by complete noobs under heavy fire.'},
 drunk:{t:'Drink state',h:'<p>Base/aim penalties: tipsy −5/−10, drunk −20/−40, wasted −50/−90, hungover −10/−15. Aim penalties are roughly double — drunk mercs are snap-shooters only.</p>',hr:'Wasted renders aiming near-impossible.'},
 gassed:{t:'Gassed',h:'<p>In a gas cloud without a mask: −15% base / −80% aim with current values. Aiming through tears is nearly pointless.</p>',hr:'Aiming through gas is even worse than snap-shooting through it.'},
 bullets:{t:'Bullets in volley',h:'<p>Burst/auto volley length. Bullet #1 is the aimed shot (recoil-free in the engine); every later bullet adds the gun’s recoil, partially countered by strength/agility (<code>CalcCounterForceMax</code>) and skill (<code>CalcCounterForceAccuracy</code>).</p>'},
 gunRecoil:{t:'Gun recoil per bullet',h:'<p>The gun’s per-bullet muzzle climb (Weapons.xml <code>bRecoilY</code>; e.g. MP5 ≈ 6, AK-74 ≈ 7, Glock-18 ≈ 13). Attachments (foregrip, bipod) boost the counter-force that fights it.</p>'},
 aprange:{t:'Range',h:'<p>Distance to the target. Distances here follow the game’s convention: 1 tile = 10 map units = 10 meters (per the INI’s own documentation).</p>'},
 laser:{t:'Laser pointer',h:'<p>Lasers shrink the base aperture by <code>LASER_PERFORMANCE_BONUS_*</code> (hip/iron/scope), scaled by darkness at the target — the dot is easier to see at night. Full bonus inside laser range, fading to zero at ~1.2–2.5× range.</p>'},
 laserRange:{t:'Laser range',h:'<p>The attachment’s <code>BestLaserRange</code> (Laser Sight 100 units = 10 tiles, Rifle LAM 300 = 30 tiles). Beyond it the bonus fades linearly, dying entirely at a light-dependent maximum (~1.2× in daylight, ~2.5× in darkness).</p>'},
 dark:{t:'Target darkness',h:'<p>How dark the target’s tile is (0 = bright day, 100 = night). Darker = the laser dot is more visible = bigger laser bonus, and it extends the laser’s falloff range.</p>'},
 bulletdev:{t:'Gun bullet-deviation',h:'<p>The second scatter layer (<code>CalcBulletDeviation</code>): the gun’s own inaccuracy, on top of the muzzle-sway cone and <b>invisible on the cursor</b>. Scales with <code>MAX_BULLET_DEV × (100−accuracy)</code> and steps up at 2×/3× the gun’s effective range (integer division in the source).</p>'},
 wpn:{t:'Weapon example',h:'<p>Loads representative stats from <code>Weapons.xml</code>: handling, aim levels, recoil, accuracy and effective range (Glock-18, MP5, AK-74, FN FAL, MG36, SPAS-15, SVD).</p>'},
 'att.bipod':{t:'Bipod (rested)',h:'<p>When deployed (prone / weapon rest): +100% max counter-force, +35% counter-accuracy, and the shot gets the prone boni (flattened cone). Costs +20% handling when carried. Values from Items.xml.</p>'},
 'att.foregrip':{t:'Foregrip',h:'<p>+70% max counter-force, +30% counter-accuracy, −10% handling (from Items.xml) — the all-round burst-control attachment that also slightly helps snap shots.</p>'},
 'att.match':{t:'Match ammo',h:'<p>Match-grade magazines carry <code>PercentAccuracyModifier = 10</code>: +10% gun accuracy, which shrinks the bullet-deviation scatter layer. No effect on the cursor %.</p>'},
 'att.extender':{t:'Barrel extender',h:'<p>Extends the gun’s effective range (~+25%), which delays the range-dependent growth of bullet deviation. Warning: in the engine it can fall off when firing.</p>'},
 scope:{t:'Optic',h:'<p>Real scope magnifications from Items.xml (2× / 3.5× G36 / 4× ACOG &amp; PSO-1 / 7× / 10×). Each has a minimum effective range ≈ <code>mag × NORMAL_SHOOTING_DISTANCE × SCOPE_RANGE_MULTIPLIER</code>.</p>'},
 cond:{t:'Other condition modifier',h:'<p>A free-form extra percentage on both CTH halves — stand-in for anything not modeled (weather mods, situational penalties).</p>'},
};
function infoBtn(key){ return `<button class="ib" type="button" data-info="${key}" title="What is this?">i</button>`; }
function escHtml(t){ return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
let _modal=null;
function ensureModal(){ if(_modal||typeof document==='undefined'||!document.body) return;
  _modal=document.createElement('div'); _modal.id='ncth-modal';
  _modal.innerHTML='<div class="im-card"><button class="im-x" type="button">×</button><h3 id="im-t"></h3><div id="im-b"></div></div>';
  document.body.appendChild(_modal);
  _modal.addEventListener('click',e=>{ if(e.target===_modal||e.target.classList.contains('im-x')) _modal.style.display='none'; });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') _modal.style.display='none'; });
}
function showInfo(key){
  ensureModal(); if(!_modal) return;
  let title='', body='';
  if(key.indexOf('ini:')===0){
    const k=key.slice(4), mp=INIMAP[k]; if(!mp) return;
    const ini=mp[0];
    title=ini;
    const P=(typeof window!=='undefined'&&window.NCTH_PARAMS)?window.NCTH_PARAMS.find(p=>p.key===ini):null;
    body+=`<div class="im-meta">${mp[1]==='Ja2_Options.INI'?'Ja2_Options.INI':'CTHConstants.ini · ['+mp[1]+']'}`+(P?` · current value <b>${escHtml(P.value)}</b>`:'')+`</div>`;
    if(P&&P.effect) body+=`<p><b>Raising it:</b> ${escHtml(P.effect)}</p>`;
    if(P&&P.desc) body+=`<p>${escHtml(P.desc)}</p>`;
    if(HR[ini]) body+=`<p class="im-hr">“${HR[ini]}”<br><span>— Headrock, NCTH design notes (2010)</span></p>`;
  } else {
    const e=INFO[key]; if(!e) return;
    title=e.t; body=e.h;
    if(e.hr) body+=`<p class="im-hr">“${e.hr}”<br><span>— Headrock, NCTH design notes (2010)</span></p>`;
  }
  body+=`<p class="im-src">NCTH was designed and written by <b>Headrock</b>. Deep dive: <a href="${THREAD}" target="_blank" rel="noopener">“New Chance To Hit system — The Formula” (The Bear’s Pit)</a>.</p>`;
  _modal.querySelector('#im-t').textContent=title;
  _modal.querySelector('#im-b').innerHTML=body;
  _modal.style.display='block';
}
if(typeof document!=='undefined'&&document.addEventListener){
  document.addEventListener('click',e=>{ const b=e.target&&e.target.closest&&e.target.closest('[data-info]');
    if(b){ e.preventDefault(); showInfo(b.dataset.info); } });
}
// resolve an info key for a bound control path; null if we have nothing to say
function infoKeyFor(path){
  if(path.indexOf('PROP.')===0||path.indexOf('CUR.')===0){ const k=path.split('.')[1]; return INIMAP[k]?('ini:'+k):null; }
  return INFO[path]?path:null;
}

// ---- INI export: internal key -> real INI key/section/file ----
const G='General',BC='Base CTH',AC='Aiming CTH',SM='Shooting Mechanism',JO='Ja2_Options.INI';
const INIMAP={
  DEG_APERTURE:['DEGREES_MAXIMUM_APERTURE',G], NORMAL_DIST:['NORMAL_SHOOTING_DISTANCE',G],
  IRON_PERF:['IRON_SIGHT_PERFORMANCE_BONUS',G], IRON_GRAD:['IRON_SIGHTS_MAX_APERTURE_USE_GRADIENT',G,'bool'],
  IRON_MOD:['IRON_SIGHTS_MAX_APERTURE_MODIFIER',G], VERT_BIAS:['VERTICAL_BIAS',G],
  SCOPE_EFF_MULT:['SCOPE_EFFECTIVENESS_MULTIPLIER',G], SCOPE_EFF_MIN:['SCOPE_EFFECTIVENESS_MINIMUM',G],
  SCOPE_RANGE_MULT:['SCOPE_RANGE_MULTIPLIER',G], LASER_IRON:['LASER_PERFORMANCE_BONUS_IRON',G],
  LASER_HIP:['LASER_PERFORMANCE_BONUS_HIP',G], LASER_SCOPE:['LASER_PERFORMANCE_BONUS_SCOPE',G],
  BASE_EXP:['BASE_EXP',BC], BASE_MARKS:['BASE_MARKS',BC], BASE_WIS:['BASE_WIS',BC], BASE_DEX:['BASE_DEX',BC],
  BASE_DRAW:['BASE_DRAW_COST',BC], BASE_STAND:['BASE_STANDING_STANCE',BC], BASE_CROUCH:['BASE_CROUCHING_STANCE',BC],
  BASE_PRONE:['BASE_PRONE_STANCE',BC], BASE_INJURY:['BASE_INJURY',BC], BASE_FATIGUE:['BASE_FATIGUE',BC],
  BASE_SHOCK:['BASE_SHOCK',BC], BASE_GASSED:['BASE_GASSED',BC], BASE_HIMORALE:['BASE_HIGH_MORALE',BC], BASE_LOMORALE:['BASE_LOW_MORALE',BC],
  AIM_EXP:['AIM_EXP',AC], AIM_MARKS:['AIM_MARKS',AC], AIM_WIS:['AIM_WIS',AC], AIM_DEX:['AIM_DEX',AC],
  AIM_DRAW:['AIM_DRAW_COST',AC], AIM_INJURY:['AIM_INJURY',AC], AIM_FATIGUE:['AIM_FATIGUE',AC], AIM_SHOCK:['AIM_SHOCK',AC],
  AIM_GASSED:['AIM_GASSED',AC], AIM_HIMORALE:['AIM_HIGH_MORALE',AC], AIM_LOMORALE:['AIM_LOW_MORALE',AC],
  AIM_VISIBILITY:['AIM_VISIBILITY',AC], AIM_TARGET_INVISIBLE:['AIM_TARGET_INVISIBLE',AC],
  AIM_TOO_CLOSE:['AIM_TOO_CLOSE_SCOPE',AC], AIM_TOO_CLOSE_THRESH:['AIM_TOO_CLOSE_THRESHOLD',AC],
  MAX_BULLET_DEV:['MAX_BULLET_DEV',SM], RANGE_EFFECTS_DEV:['RANGE_EFFECTS_DEV',SM,'bool'], NORMAL_RECOIL_DIST:['NORMAL_RECOIL_DISTANCE',SM],
  RC_MAX_STR:['RECOIL_MAX_COUNTER_STR',SM], RC_MAX_AGI:['RECOIL_MAX_COUNTER_AGI',SM], RC_MAX_EXP:['RECOIL_MAX_COUNTER_EXP_LEVEL',SM],
  RC_MAX_FORCE:['RECOIL_MAX_COUNTER_FORCE',SM], RC_MAX_CROUCH:['RECOIL_MAX_COUNTER_CROUCH',SM], RC_MAX_PRONE:['RECOIL_MAX_COUNTER_PRONE',SM],
  RCA_DEX:['RECOIL_COUNTER_ACCURACY_DEX',SM], RCA_WIS:['RECOIL_COUNTER_ACCURACY_WIS',SM], RCA_AGI:['RECOIL_COUNTER_ACCURACY_AGI',SM], RCA_EXP:['RECOIL_COUNTER_ACCURACY_EXP_LEVEL',SM],
  MAX_CTH:['MAXIMUM_POSSIBLE_CTH',JO], MIN_CTH:['MINIMUM_POSSIBLE_CTH',JO],
};
const fmtV=(v,bool)=> bool?(v?'TRUE':'FALSE'):(Math.round(v*1000)/1000);
function iniDiff(s){
  const d=[];
  for(const k in INIMAP){ const [ini,sec,bool]=INIMAP[k];
    if(s.PROP[k]!==DEFAULTS[k]) d.push({k,ini,sec,file:sec===JO?JO:'CTHConstants.ini',cur:DEFAULTS[k],prop:s.PROP[k],bool:bool==='bool'}); }
  return d;
}
function iniText(s){
  const d=iniDiff(s); if(!d.length) return '';
  const out=['; ===== Proposed NCTH tuning =====','; Requires NCTH = TRUE (Ja2_Options.INI, [Tactical Gameplay Settings])',''];
  const byFileSec={};
  d.forEach(x=>{ const key=x.file+'|'+x.sec; (byFileSec[key]=byFileSec[key]||[]).push(x); });
  Object.keys(byFileSec).sort().forEach(fs=>{ const [file,sec]=fs.split('|');
    out.push(`; --- ${file}  [${sec}] ---`);
    byFileSec[fs].forEach(x=> out.push(`${x.ini} = ${fmtV(x.prop,x.bool)}   ; was ${fmtV(x.cur,x.bool)}`));
    out.push(''); });
  return out.join('\n');
}
function exportCard(prefix){ prefix=prefix||'exp';
  return `<div class="card"><h2>Proposed changes <span class="propflag">(vs vanilla)</span></h2>
    <div id="${prefix}_diff" class="note">No changes yet — edit a slider above.</div>
    <textarea id="${prefix}_ini" readonly style="width:100%;height:120px;margin-top:8px;background:#0e1219;color:#bfe3ff;border:1px solid #2a3346;border-radius:6px;font:11.5px ui-monospace,Menlo,monospace;padding:8px;display:none"></textarea>
    <button id="${prefix}_copy" style="display:none;margin-top:8px" class="chip">Copy INI block</button>
    <span id="${prefix}_msg" style="color:var(--good);font-size:12px;margin-left:8px"></span></div>`;
}
function renderExport(s,prefix){ prefix=prefix||'exp';
  const d=iniDiff(s), diffEl=document.getElementById(prefix+'_diff'), ta=document.getElementById(prefix+'_ini'), btn=document.getElementById(prefix+'_copy');
  if(!diffEl) return;
  if(!d.length){ diffEl.innerHTML='No changes yet — edit a slider above.'; ta.style.display='none'; btn.style.display='none'; return; }
  diffEl.innerHTML='<table style="margin-top:2px"><tr><th>Key</th><th>was</th><th>→ now</th></tr>'+
    d.map(x=>`<tr><td style="font-family:ui-monospace,monospace;font-size:11px;color:#bfe3ff">${x.ini}</td><td>${fmtV(x.cur,x.bool)}</td><td style="color:var(--prop);font-weight:700">${fmtV(x.prop,x.bool)}</td></tr>`).join('')+'</table>';
  ta.value=iniText(s); ta.style.display='block'; btn.style.display='inline-block';
  if(!btn.dataset.wired){ btn.dataset.wired='1'; btn.onclick=()=>{ ta.select();
    try{ navigator.clipboard.writeText(ta.value); }catch(e){ try{document.execCommand('copy');}catch(_){} }
    const m=document.getElementById(prefix+'_msg'); if(m){ m.textContent='copied ✓'; setTimeout(()=>m.textContent='',1500); } }; }
}
// push every [data-bind] control + [data-seg] toggle back in sync with current state
function syncControls(root,s){ if(!root) return;
  const g=p=>p.includes('.')?s[p.split('.')[0]][p.split('.')[1]]:s[p];
  root.querySelectorAll('[data-bind]').forEach(el=>{ const v=g(el.dataset.bind);
    if(el.type==='range'||el.type==='number'||el.tagName==='SELECT') el.value=v;
    const out=el.parentElement.querySelector('.val');
    if(out) out.textContent=('dist' in el.dataset)?fmtDist(parseFloat(el.value)):el.value+(el.dataset.fmt||''); });
  root.querySelectorAll('[data-seg]').forEach(seg=>{ const v=g(seg.dataset.seg);
    seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',String(v)===b.dataset.v)); });
}
// active non-default modifiers banner — with context-appropriate reset links
function banner(s){
  const cond=[];
  if(s.health<100) cond.push(`health ${s.health}%`); if(s.breath<100) cond.push(`breath ${s.breath}%`);
  if(s.shock>0) cond.push(`shock ${s.shock}`); if(s.drunk>0) cond.push(['tipsy','drunk','wasted','hungover'][s.drunk-1]);
  if(s.gassed) cond.push('gassed'); if(s.morale) cond.push(`morale ${s.morale>0?'+':''}${s.morale}`);
  if(s.vis<100) cond.push(`visibility ${s.vis}%`); if(s.bulletdev) cond.push('gun-deviation');
  const gear=ATTACHMENTS.filter(a=>A(s)[a.key]).map(a=>a.key);
  const nprop=iniDiff(s).length;
  if(!cond.length && !gear.length && !nprop) return '';
  const link=(id,txt)=>`<a href="#" id="${id}" style="color:var(--acc);margin-left:5px">${txt}</a>`;
  const parts=[];
  if(cond.length) parts.push(`${cond.join(' · ')} ${link('banreset','reset conditions')}`);
  if(gear.length) parts.push(`gear: ${gear.join(', ')} ${link('banresetgear','remove')}`);
  if(nprop) parts.push(`${nprop} proposed edit${nprop>1?'s':''} ${link('banresetedits','reset edits')}`);
  return `<div style="max-width:1780px;margin:0 auto;padding:6px 18px"><span style="background:rgba(255,207,92,.12);border:1px solid #4a4327;color:var(--warn);border-radius:8px;padding:5px 10px;font-size:12px">⚙ Active: ${parts.join(' &nbsp;•&nbsp; ')}</span></div>`;
}
function wireBannerReset(s,render){
  const root=document.querySelector('.lab');
  const doReset=fn=>e=>{ e.preventDefault(); fn(); syncControls(root,s); save(s); if(render) render(); };
  const a=document.getElementById('banreset'); if(a) a.onclick=doReset(()=>{ const f=freshState();
    ['health','breath','morale','shock','drunk','gassed','vis','bulletdev'].forEach(k=>s[k]=f[k]); });
  const g=document.getElementById('banresetgear'); if(g) g.onclick=doReset(()=>{ s.att={bipod:0,foregrip:0,match:0,extender:0}; });
  const b=document.getElementById('banresetedits'); if(b) b.onclick=doReset(()=>{ s.PROP=Object.assign({},DEFAULTS); });
}
// heatmap: rows x cols grid colored by value 0..100 (hover: cell tooltip)
function heatmap(cv, rows, cols, cell, opts){ opts=opts||{};
  const w=cv.parentElement.clientWidth-28; cv.width=w; cv.style.width=w+'px';
  const ctx=cv.getContext('2d'), H=cv.height, L=96, T=8, B=22, pw=w-L-8, ph=H-T-B;
  ctx.clearRect(0,0,w,H); ctx.font='11px sans-serif';
  const cw=pw/cols.length, chh=ph/rows.length;
  const grid=rows.map((r,ri)=>cols.map((c,ci)=>cell(ri,ci)));
  rows.forEach((r,ri)=>{ cols.forEach((c,ci)=>{ const v=grid[ri][ci];
      ctx.fillStyle=`hsl(${Math.max(0,Math.min(120,v*1.2))},58%,42%)`;
      ctx.fillRect(L+ci*cw, T+ri*chh, cw-1, chh-1);
      if(cw>26){ ctx.fillStyle='#0c1017'; ctx.fillText(Math.round(v), L+ci*cw+cw/2-7, T+ri*chh+chh/2+4); } });
    ctx.fillStyle='#cdd6e4'; ctx.fillText(r.label, 2, T+ri*chh+chh/2+4); });
  ctx.fillStyle='#93a1b5';
  cols.forEach((c,ci)=>{ if(ci%2===0) ctx.fillText(opts.xdist?Math.round(distVal(c)):c, L+ci*cw+cw/2-6, H-6); });
  ctx.fillText(opts.xdist?distAxisLabel():(opts.xlabel||''), L+pw/2-20, H-6);
  cv._heat={grid,rows,cols,L,T,cw,chh,ph,xdist:opts.xdist};
  if(!cv._tipWired){ cv._tipWired=true;
    cv.addEventListener('mousemove',e=>{ const h=cv._heat; if(!h) return;
      const r=cv.getBoundingClientRect(); if(!r||!r.width) return;
      const mx=(e.clientX-r.left)*(cv.width/r.width), my=(e.clientY-r.top)*(cv.height/r.height);
      const ci=Math.floor((mx-h.L)/h.cw), ri=Math.floor((my-h.T)/h.chh);
      if(ri<0||ri>=h.rows.length||ci<0||ci>=h.cols.length||my<h.T||my>h.T+h.ph){ hideTip(); return; }
      const at=h.xdist?fmtDist(h.cols[ci]):h.cols[ci];
      tip(e.clientX,e.clientY,`<b>${h.rows[ri].label}</b> @ ${at}<br>real hit: <b>${h.grid[ri][ci].toFixed(0)}%</b>`);
    });
    cv.addEventListener('mouseleave',hideTip);
  }
}

// export
// representative loadouts (from Weapons.xml / Items.xml)
const WEAPONS=[
  {name:'Pistol (Glock 18)',    handling:9,  maxaim:3, gunRecoil:13, acc:45, effRange:115},
  {name:'SMG (MP5)',            handling:8,  maxaim:4, gunRecoil:6,  acc:40, effRange:175},
  {name:'Assault rifle (AK-74)',handling:11, maxaim:4, gunRecoil:7,  acc:63, effRange:330},
  {name:'Battle rifle (FN FAL)',handling:12, maxaim:5, gunRecoil:9,  acc:72, effRange:630},
  {name:'LMG (MG36)',           handling:13, maxaim:4, gunRecoil:6,  acc:67, effRange:365},
  {name:'Shotgun (SPAS-15)',    handling:10, maxaim:3, gunRecoil:6,  acc:25, effRange:150},
  {name:'Sniper rifle (SVD)',   handling:12, maxaim:6, gunRecoil:0,  acc:84, effRange:790},
];
const SCOPES=[
  {name:'Iron sights',      sight:'iron',  mag:1},
  {name:'Reflex / red-dot', sight:'iron',  mag:1},
  {name:'2× scope',         sight:'scope', mag:2},
  {name:'3.5× (G36)',       sight:'scope', mag:3.5},
  {name:'4× ACOG / PSO-1',  sight:'scope', mag:4},
  {name:'7× scope',         sight:'scope', mag:7},
  {name:'10× sniper scope', sight:'scope', mag:10},
];
// target silhouette presets (from JSD cube sizes: ~2u wide, ~6u tall per cube; LOS.cpp:9647)
// standing 3 tall x3 wide, crouch 2x3, prone 1 tall x3 wide (low frontal profile)
const TARGETS=[
  {name:'Standing', tw:3,   th:9},
  {name:'Crouched', tw:3,   th:6},
  {name:'Prone',    tw:3.5, th:3},
  {name:'Head only',tw:1.5, th:2},
];
// attachments that influence CTH/recoil (values from Items.xml)
const ATTACHMENTS=[
  {key:'bipod',    name:'Bipod (rested / prone)', eff:'weapon rest → prone boni · +100% recoil control · +20% handling (bulkier)'},
  {key:'foregrip', name:'Foregrip / angled grip', eff:'+70% recoil control · +30% counter-accuracy · −10% handling'},
  {key:'match',    name:'Match ammo', eff:'+10% gun accuracy → less bullet-deviation scatter'},
  {key:'extender', name:'Barrel extender',        eff:'+25% effective range → less long-range bullet deviation'},
];
function attachCard(keys){ const list=keys?ATTACHMENTS.filter(a=>keys.includes(a.key)):ATTACHMENTS;
  return `<div class="card"><h2>Attachments</h2>`+list.map(a=>
    `<div class="row"><label>${a.name}<br><span style="color:#6f7d92;font-size:11px">${a.eff}</span></label>
      <div class="seg" data-seg="att.${a.key}" data-num><button data-v="0">Off</button><button data-v="1">On</button></div></div>`).join('')+
    `<div class="note">Effects are representative, taken from the vanilla items. Laser/scope live on the <a href="optics.html">Optics</a> tab.</div></div>`;
}

window.NCTH={ DEFAULTS, WEAPONS, SCOPES, ATTACHMENTS, TARGETS, attachCard, load, save, freshState,
  baseAttr, capAttr, condMods, displayedCTH, effMag, scopeEffMag, scopeMinRange, aperture, bulletDevRadius, hitProb, realHit,
  cfAccuracy, cfMax, burst, vbias,
  nav, bind, shooterCard, tuningCard, lineChart, pill, CELL,
  iniDiff, iniText, exportCard, renderExport, banner, wireBannerReset, syncControls, heatmap,
  tip, hideTip, fmtDist, distVal, distAxisLabel, units:()=>UNITS, setUnits,
  infoBtn, showInfo, THREAD };
})();
