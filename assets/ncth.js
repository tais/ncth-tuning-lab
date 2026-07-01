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
    stance:'stand', diff:3, prog:0,
    handling:11, maxaim:6, sight:'iron', mag:4,
    tw:3.5, th:10,
    // gun deviation / visibility
    acc:63, effRange:330, bulletdev:0, vis:100,
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

// displayed CTH at aim level t. opts:{dTiles,sight,mag} enable the scope too-close penalty
function displayedCTH(s,C,t,opts){
  opts=opts||{};
  let base=baseAttr(s,C);
  if(base<=C.MIN_CTH) return C.MIN_CTH;
  const cm=condMods(s,C);
  const baseMod=-(s.handling*stanceBase(s,C)*C.BASE_DRAW) + playerDiff(s) + cm.base;
  base=Math.max(0,Math.min(100, base*(100+baseMod)/100));
  if(t<=0) return Math.max(C.MIN_CTH, Math.min(base,C.MAX_CTH));
  let cap=Math.min(Math.max(capAttr(s,C), Math.max(0,base)), C.MAX_CTH);
  let aimMod=-(C.AIM_DRAW*s.handling*stanceAim(s,C)) + playerDiff(s) + cm.aim;
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
const vbias=(s,C)=> s.stance==='stand'?1 : s.stance==='prone'?C.VERT_BIAS : 1+(C.VERT_BIAS-1)*0.66;

// gun bullet-deviation radius (2nd scatter layer, absent from displayed CTH). CalcBulletDeviation, LOS.cpp:9541
function bulletDevRadius(s,C,dUnits){
  if(!s.bulletdev) return 0;
  let dev=C.MAX_BULLET_DEV*(100-s.acc)/100;
  if(C.RANGE_EFFECTS_DEV) dev*=Math.max(1, dUnits/(s.effRange||1));
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
           ['autofire.html','Recoil & Autofire'],['compare.html','Compare']];
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
    const out=el.parentElement.querySelector('.val'); if(out) out.textContent=el.value+(el.dataset.fmt||''); });
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
  const nprop=iniDiff(s).length;
  if(!cond.length && !nprop) return '';
  const link=(id,txt)=>`<a href="#" id="${id}" style="color:var(--acc);margin-left:5px">${txt}</a>`;
  const parts=[];
  if(cond.length) parts.push(`${cond.join(' · ')} ${link('banreset','reset conditions')}`);
  if(nprop) parts.push(`${nprop} proposed edit${nprop>1?'s':''} ${link('banresetedits','reset edits')}`);
  return `<div style="max-width:1780px;margin:0 auto;padding:6px 18px"><span style="background:rgba(255,207,92,.12);border:1px solid #4a4327;color:var(--warn);border-radius:8px;padding:5px 10px;font-size:12px">⚙ Active: ${parts.join(' &nbsp;•&nbsp; ')}</span></div>`;
}
function wireBannerReset(s,render){
  const root=document.querySelector('.lab');
  const doReset=fn=>e=>{ e.preventDefault(); fn(); syncControls(root,s); save(s); if(render) render(); };
  const a=document.getElementById('banreset'); if(a) a.onclick=doReset(()=>{ const f=freshState();
    ['health','breath','morale','shock','drunk','gassed','vis','bulletdev'].forEach(k=>s[k]=f[k]); });
  const b=document.getElementById('banresetedits'); if(b) b.onclick=doReset(()=>{ s.PROP=Object.assign({},DEFAULTS); });
}
// heatmap: rows x cols grid colored by value 0..100
function heatmap(cv, rows, cols, cell, opts){ opts=opts||{};
  const w=cv.parentElement.clientWidth-28; cv.width=w; cv.style.width=w+'px';
  const ctx=cv.getContext('2d'), H=cv.height, L=96, T=8, B=22, pw=w-L-8, ph=H-T-B;
  ctx.clearRect(0,0,w,H); ctx.font='11px sans-serif';
  const cw=pw/cols.length, chh=ph/rows.length;
  rows.forEach((r,ri)=>{ cols.forEach((c,ci)=>{ const v=cell(ri,ci);
      ctx.fillStyle=`hsl(${Math.max(0,Math.min(120,v*1.2))},58%,42%)`;
      ctx.fillRect(L+ci*cw, T+ri*chh, cw-1, chh-1);
      if(cw>26){ ctx.fillStyle='#0c1017'; ctx.fillText(Math.round(v), L+ci*cw+cw/2-7, T+ri*chh+chh/2+4); } });
    ctx.fillStyle='#cdd6e4'; ctx.fillText(r.label, 2, T+ri*chh+chh/2+4); });
  ctx.fillStyle='#93a1b5';
  cols.forEach((c,ci)=>{ if(ci%2===0) ctx.fillText(c, L+ci*cw+cw/2-6, H-6); });
  ctx.fillText(opts.xlabel||'', L+pw/2-20, H-6);
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

window.NCTH={ DEFAULTS, WEAPONS, SCOPES, load, save, freshState,
  baseAttr, capAttr, condMods, displayedCTH, effMag, scopeEffMag, scopeMinRange, aperture, bulletDevRadius, hitProb, realHit,
  cfAccuracy, cfMax, burst, vbias,
  nav, bind, shooterCard, tuningCard, lineChart, pill, CELL,
  iniDiff, iniText, exportCard, renderExport, banner, wireBannerReset, syncControls, heatmap };
})();
