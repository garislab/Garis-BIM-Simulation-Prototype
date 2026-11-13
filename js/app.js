(function(){
"use strict";
const $=id=>document.getElementById(id);
const rad=Math.PI/180;

/* ================= bahasa ================= */
const I=window.I18N;
function pickLang(){
  try{const q=new URLSearchParams(location.search).get("lang"); if(q&&I[q]) return q;
    const s=localStorage.getItem("fh-lang"); if(s&&I[s]) return s;}catch(e){}
  return "en";
}
let LANG=pickLang();
function t(k,v){
  let s=I[LANG][k]; if(s===undefined) s=I.en[k];
  if(s===undefined){console.warn("i18n missing:",k);return k;}
  if(v&&typeof s==="string") s=s.replace(/\{(\w+)\}/g,(m,n)=>v[n]!==undefined?v[n]:m);
  return s;
}
const nf=(x,d=0)=>(+x).toLocaleString(LANG==="id"?"id-ID":"en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const sgn=(x,d=0)=>(x>0?"+":x<0?"−":"")+nf(Math.abs(x),d);

/* ================= iklim & matahari ================= */
const LAT=-6.2, LON=106.8, TZ=7;
const TMAX=[31.0,31.0,32.0,32.6,32.8,32.4,32.4,32.9,33.4,33.4,32.7,31.8];
const TMIN=[24.6,24.6,24.8,25.2,25.4,24.9,24.4,24.5,24.8,25.2,25.1,24.8];
const KCL=[.55,.55,.65,.72,.78,.80,.83,.85,.85,.80,.70,.60];
const DOY=[21,52,80,111,141,172,202,233,264,294,325,355];
function sunAt(n,h){
  const decl=23.45*Math.sin(2*Math.PI*(284+n)/365)*rad;
  const B=2*Math.PI*(n-81)/364;
  const eot=9.87*Math.sin(2*B)-7.53*Math.cos(B)-1.5*Math.sin(B);
  const st=h+(4*(LON-15*TZ)+eot)/60;
  const H=15*(st-12)*rad, phi=LAT*rad;
  const sa=Math.sin(phi)*Math.sin(decl)+Math.cos(phi)*Math.cos(decl)*Math.cos(H);
  const alt=Math.asin(Math.max(-1,Math.min(1,sa)));
  const az=Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(decl)*Math.cos(phi))+Math.PI;
  return {alt,az,x:Math.sin(az)*Math.cos(alt),y:Math.cos(az)*Math.cos(alt),z:Math.sin(alt)};
}
function tempProfile(h){
  if(h>=6&&h<=14) return 0.5-0.5*Math.cos(Math.PI*(h-6)/8);
  const d=((h-14)+24)%24; return 0.5+0.5*Math.cos(Math.PI*d/16);
}
function weather(month){
  const n=DOY[month], k=KCL[month], arr=new Array(1440);
  for(let i=0;i<1440;i++){
    const h=i/60, s=sunAt(n,h);
    let dni=0,dhi=0;
    if(s.alt>0.01){
      const m=1/Math.max(Math.sin(s.alt),0.05);
      const dnic=1080*Math.exp(-0.21*m);
      dni=dnic*k; dhi=(0.12*dnic+30)*(1+(1-k)*1.5)*Math.min(1,Math.sin(s.alt)*4);
    }
    arr[i]={h,s,dni,dhi,ghi:dni*Math.max(0,s.z)+dhi,To:TMIN[month]+(TMAX[month]-TMIN[month])*tempProfile(h)};
  }
  return arr;
}
const OCC=[0,0,0,0,0,0,0,0,0,0,0.2,0.5,1.0,0.9,0.5,0.4,0.5,0.7,1.0,1.0,0.8,0.5,0,0,0];
function sched(h){const a=Math.floor(h),f=h-a;return OCC[a]*(1-f)+OCC[a+1]*f}
const isOpen=h=>h>=10&&h<22;
const acOn=h=>h>=9.5&&h<22;
const coolEff=v=>v<=0.1?0:Math.min(4,3*Math.log(1+v/0.2)/Math.log(6));
const FAN_V=0.6, FAN_C=coolEff(FAN_V), FAN_SP=2, FAN_W=2, COMFORT=30, MIX_SP=27, MIX_H=[12,18], INV_K=1.4;

/* ================= solusi desain ================= */
/* d: domain yang dipengaruhi. Angka dampak dihitung dari simulasi, bukan ditulis tangan. */
const SOLN=[
  {id:"roof",    d:["energi","suhu"],                    ico:"roof"},
  {id:"louver",  d:["energi","suhu","cahaya"],           ico:"fins"},
  {id:"trees",   d:["suhu","cahaya","suara","udara"],    ico:"tree"},
  {id:"sensor",  d:["cahaya","energi"],                  ico:"bulb"},
  {id:"fans",    d:["suhu","energi"],                    ico:"fan"},
  {id:"cross",   d:["udara","suhu"],                     ico:"wind"},
  {id:"glazing", d:["suara","suhu","udara","energi"],    ico:"glass"},
  {id:"railwall",d:["suara","udara"],                    ico:"wall"},
  {id:"asphalt", d:["suara"],                            ico:"road"},
  {id:"mixed",   d:["suhu","energi"],                    ico:"clock"},
  {id:"inverter",d:["energi"],                           ico:"snow"}
];
const SOLBY=Object.fromEntries(SOLN.map(s=>[s.id,s]));
const AIRSOL=["cross","glazing","trees","railwall"];
const ON=new Set();

/* ================= zona ================= */
const PROP={wall:{U:2.4,a:.55},slabroof:{U:2.6,a:.65},roof:{U:5.0,a:.35},glass:{U:5.7,g:.7},poly:{U:3.6,g:.6}};
const PROP_ROOF_INS={U:1.0,a:.25}, PROP_SLAB_INS={U:0.9,a:.35}, PROP_LAM={U:2.8,g:.4};
const zones=MODEL.zones.map((z,mi)=>{
  const sky=z.env.filter(e=>e[0]==="open"&&e[1]===-1).reduce((s,e)=>s+e[2],0);
  return {...z,mi,lvl:+z.st.slice(-1),sky,outdoor:sky>0.5*z.A,equip:z.st==="LANTAI 1"?25:6,dens:z.st==="LANTAI 3"?0.3:0.5};
});
zones.sort((a,b)=>(+a.name)-(+b.name));
const zLabel=z=>t("zone",{n:z.name}), zStorey=z=>t("storey",{n:z.lvl});
const byModelIdx=[];zones.forEach((z,i)=>byModelIdx[z.mi]=i);
const indoor=zones.filter(z=>!z.outdoor);
const condArea=indoor.reduce((s,z)=>s+z.A,0);
const isWest=az=>az>=5&&az<=7;
function incident(az,w,fd,fs){
  if(w.ghi<=0) return 0;
  if(az<0) return w.ghi;
  const th=az*45*rad, c=Math.max(0,Math.sin(th)*w.s.x+Math.cos(th)*w.s.y);
  return w.dni*c*fd+(w.dhi*0.5+0.1*w.ghi)*fs;
}
const CAP=220;
const COMP=["roof","glaz","wall","vent","people","equip","light","latent"];
const COMPCOL={roof:"#e0a02a",glaz:"#3d9be0",wall:"#9a8f80",vent:"#5bb98c",people:"#d65b8a",equip:"#e0632b",light:"#c9c24a",latent:"#7a6ad8"};
const P={month:9,sp:25,occ:1,cop:3.2,wind:2,windDir:0,lux:300,level:1,traffic:1,listen:"kamera",vol:0.8};
let W=null;
function simulate(ac,S,lux){
  const N=144, dt=60, steps=3*1440, vk=0.06*Math.max(0.3,P.wind)*(S.has("cross")?1.35:1);
  const fdW=(S.has("louver")?0.35:1)*(S.has("trees")?0.6:1), fsW=(S.has("louver")?0.85:1)*(S.has("trees")?0.85:1);
  const glz=S.has("glazing"), roofP=S.has("roof")?PROP_ROOF_INS:PROP.roof, slabP=S.has("roof")?PROP_SLAB_INS:PROP.slabroof;
  const mixed=S.has("mixed"), dim=S.has("sensor")&&lux?lux.dimFrac:null, fans=S.has("fans")&&(!ac||mixed);
  const sp=(mixed?MIX_SP:P.sp)+(S.has("fans")?FAN_SP:0);
  const acAt=mixed?(h=>h>=MIX_H[0]&&h<MIX_H[1]):(ac?acOn:()=>false);
  const comp={}; COMP.forEach(k=>comp[k]=new Float64Array(N));
  const res=zones.map(()=>({T:new Float64Array(N),Q:new Float64Array(N)}));
  zones.forEach((z,zi)=>{
    const r=res[zi];
    if(z.outdoor){for(let j=0;j<N;j++) r.T[j]=W[j*10].To; return;}
    const C=1.2*1005*z.V+z.A*120000; let T=27.5;
    const mkEnv=closed=>z.env.map(e=>{
      let typ=e[0]; const az=e[1], A=e[2], west=isWest(az);
      const opening=typ==="open"||typ==="mesh";
      let kind;
      if(opening&&glz&&west) kind="lam";
      else if(opening&&closed) kind="glass";
      else kind=typ;
      const p=kind==="lam"?PROP_LAM:kind==="roof"?roofP:kind==="slabroof"?slabP:PROP[kind];
      return {typ,kind,az,A,p,fd:west?fdW:1,fs:west?fsW:1,shade:(kind==="glass"&&opening)?0.5:1,mesh:typ==="mesh"};
    });
    const envOpen=mkEnv(false), envAC=mkEnv(true);
    for(let s=0;s<steps;s++){
      const mi=s%1440, w=W[mi], h=w.h, To=w.To, cooling=acAt(h), closed=(ac&&!mixed)||cooling, env=closed?envAC:envOpen;
      let qroof=0,qglaz=0,qwall=0,vdot=0;
      for(const e of env){
        if(e.kind==="open"||e.kind==="mesh"){
          if(e.az>=0) vdot+=(e.mesh?0.5:1)*vk*e.A; else {vdot+=0.15*e.A; qroof+=0.2*w.ghi*e.A;}
          continue;
        }
        const p=e.p; if(!p) continue;
        const Iinc=incident(e.az,w,e.fd,e.fs);
        if(p.g!==undefined) qglaz+=p.U*e.A*(To-T)+p.g*e.shade*e.A*Iinc;
        else { const q=p.U*e.A*(To+p.a*Iinc/20-T); if(e.kind==="wall") qwall+=q; else qroof+=q; }
      }
      const ach=closed?0.7:1.5;
      vdot=closed?ach*z.V/3600:Math.min(vdot+ach*z.V/3600,30*z.V/3600);
      const qvent=1.2*1005*vdot*(To-T);
      const occ=sched(h)*P.occ*z.dens*z.A, qpeople=70*occ, qlatP=45*occ;
      const qequip=(isOpen(h)?z.equip*z.A*(0.4+0.6*sched(h)):0.5*z.A)+(fans&&isOpen(h)?2*z.A:0);
      let qlight=isOpen(h)?(h>=17.5?10:6)*z.A:0.8*z.A;
      if(dim&&isOpen(h)) qlight*=dim[Math.floor(mi/10)];
      const sum=qroof+qglaz+qwall+qvent+qpeople+qequip+qlight;
      let Tn=T+sum*dt/C, Qs=0, QL=0;
      if(cooling){
        if(Tn>sp){Qs=Math.min((Tn-sp)*C/dt,CAP*z.A);Tn-=Qs*dt/C;}
        QL=qlatP+1.2*vdot*2450e3*0.008;
      }
      T=Tn;
      if(s>=2*1440&&mi%10===0){
        const j=mi/10; r.T[j]=T; r.Q[j]=Qs+QL;
        comp.roof[j]+=qroof;comp.glaz[j]+=qglaz;comp.wall[j]+=qwall;comp.vent[j]+=qvent;
        comp.people[j]+=qpeople;comp.equip[j]+=qequip;comp.light[j]+=qlight;comp.latent[j]+=cooling?QL:0;
      }
    }
  });
  const totQ=new Float64Array(N), meanT=new Float64Array(N), maxT=new Float64Array(N), feelT=new Float64Array(N);
  for(let j=0;j<N;j++){
    let q=0,ta=0,tm=-99; const cool=fans&&isOpen(j/6)?FAN_C:0;
    indoor.forEach(z=>{const r=res[zones.indexOf(z)];q+=r.Q[j];ta+=r.T[j]*z.A;tm=Math.max(tm,r.T[j]);});
    totQ[j]=q;meanT[j]=ta/condArea;maxT[j]=tm;feelT[j]=meanT[j]-cool;
  }
  res.forEach(r=>{
    r.kwh=r.Q.reduce((a,b)=>a+b,0)*600/3.6e6; r.peak=Math.max(...r.Q)/1000; r.maxT=Math.max(...r.T);
    r.hot=r.T.reduce((a,T)=>a+(T>COMFORT?1/6:0),0);
    let ho=0; for(let j=60;j<132;j++){ if(r.T[j]-(fans&&!acAt(j/6)?FAN_C:0)>COMFORT) ho+=1/6; } r.hotOpen=ho;
  });
  return {res,comp,totQ,meanT,maxT,feelT,fans,mixed,To:Float64Array.from({length:N},(_,j)=>W[j*10].To),ghi:Float64Array.from({length:N},(_,j)=>W[j*10].ghi)};
}
const lerpArr=(a,h)=>{const x=Math.min(143.999,Math.max(0,h*6)),i=Math.floor(x),f=x-i;return a[i]*(1-f)+a[(i+1)%144]*f};

/* ================= data pencahayaan ================= */
function b64(s,T){const bin=atob(s),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new T(u.buffer)}
const DAY=MODEL.day, ND=DAY.n;
const dP=b64(DAY.p,Int16Array), dZ=b64(DAY.z,Uint8Array), dV=b64(DAY.vsc,Uint8Array), dS=b64(DAY.sun,Uint8Array);
const dZone=Array.from(dZ,mi=>byModelIdx[mi]);
const dLvl=dZone.map(zi=>zones[zi].lvl);
const dIn=dZone.map(zi=>!zones[zi].outdoor);
const inPts=dIn.reduce((a,b)=>a+(b?1:0),0);
const WX=-20.6; // garis fasad barat (koordinat IFC terpusat)
const nearW12=new Uint8Array(ND), nearW8=new Uint8Array(ND);
for(let i=0;i<ND;i++){const x=dP[i*3]/100; nearW12[i]=x<WX+12?1:0; nearW8[i]=x<WX+8?1:0;}
function dayFactors(S,s){ // faktor sinar matahari & langit per titik
  const sun=new Float32Array(ND).fill(1), sky=new Float32Array(ND).fill(1);
  const lv=S.has("louver"), tr=S.has("trees"); if(!lv&&!tr) return {sun,sky};
  const west=s&&s.x<-0.1, low=s&&s.alt<40*rad;
  for(let i=0;i<ND;i++){
    if(lv&&nearW12[i]){sky[i]*=0.9; if(west) sun[i]*=0.3;}
    if(tr&&nearW8[i]){sky[i]*=0.93; if(west&&low) sun[i]*=0.6;}
  }
  return {sun,sky};
}
function luxAt(month,h,out,S){
  const mi=Math.min(1439,Math.floor(h*60)), w=W[mi];
  const Ed=w.dhi*120, En=w.dni*95*Math.max(0,w.s.z), fc=dayFactors(S,w.s);
  const x=(h-DAY.h0)/DAY.dh; let k0=Math.floor(x), f=x-k0;
  const base=month*DAY.nh*ND;
  const zsum=new Float64Array(zones.length), zn=new Float64Array(zones.length);
  for(let i=0;i<ND;i++){
    let ts=0;
    if(En>0&&k0>=-1&&k0<DAY.nh){
      const a=(k0>=0&&k0<DAY.nh)?dS[base+k0*ND+i]:0, b=(k0+1<DAY.nh&&k0+1>=0)?dS[base+(k0+1)*ND+i]:0;
      ts=(a*(1-f)+b*f)/255;
    }
    const e=Ed*dV[i]/255*fc.sky[i]+En*ts*fc.sun[i]; out[i]=e; zsum[dZone[i]]+=e; zn[dZone[i]]++;
  }
  for(let i=0;i<ND;i++){ if(dIn[i]){const z=dZone[i]; out[i]+=0.15*zsum[z]/zn[z];} }
  return out;
}
function computeDaylight(S){
  const E=new Float32Array(144*ND), tmp=new Float32Array(ND);
  const frac=new Float64Array(144), avg=new Float64Array(144), dimFrac=new Float64Array(144).fill(1);
  for(let j=0;j<144;j++){
    luxAt(P.month,j/6,tmp,S); E.set(tmp,j*ND);
    let c=0,s=0,dm=0; for(let i=0;i<ND;i++) if(dIn[i]){ const e=tmp[i]; if(e>=P.lux)c++; s+=e; dm+=e>=P.lux?0.1:Math.max(0.1,1-e/P.lux); }
    frac[j]=c/inPts; avg[j]=s/inPts; if(j>=60&&j<132) dimFrac[j]=dm/inPts;
  }
  let sda=0, ase=0, lampBase=0, lampDim=0;
  const cnt=new Uint16Array(ND), sunHit=new Uint8Array(ND);
  for(let j=60;j<102;j++) for(let i=0;i<ND;i++){ if(E[j*ND+i]>=P.lux)cnt[i]++; }
  const base=P.month*DAY.nh*ND;
  for(let k=8;k<22;k++){ const fc=dayFactors(S,sunAt(DOY[P.month],DAY.h0+k*DAY.dh));
    for(let i=0;i<ND;i++) if(dS[base+k*ND+i]*fc.sun[i]>100) sunHit[i]++; }
  for(let i=0;i<ND;i++) if(dIn[i]){ if(cnt[i]>=21)sda++; if(sunHit[i]>=4)ase++; }
  for(let j=60;j<132;j++){ const h=j/6, lpd=h>=17.5?10:6;
    for(let i=0;i<ND;i++) if(dIn[i]){ lampBase+=lpd; const e=E[j*ND+i]; lampDim+=lpd*(e>=P.lux?0.1:Math.max(0.1,1-e/P.lux)); } }
  const kBase=lampBase/6/1000, kDim=lampDim/6/1000;
  const zl=zones.map(()=>({n:0,ok:0}));
  for(let i=0;i<ND;i++){const z=zl[dZone[i]];z.n++; if(cnt[i]>=21)z.ok++;}
  return {E,frac,avg,dimFrac,sda:sda/inPts,ase:ase/inPts,kBase,kDim,lamp:S.has("sensor")?kDim:kBase,zl};
}

/* ================= three.js ================= */
const stage=$("stage"), cvs=$("gl");
const renderer=new THREE.WebGLRenderer({canvas:cvs,antialias:true,preserveDrawingBuffer:false});
renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.localClippingEnabled=true;
const clipPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),1000);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(38,1,0.5,600);
camera.position.set(-88,46,68);
const controls=new THREE.OrbitControls(camera,cvs);
controls.target.set(-14,2,0); controls.enableDamping=true; controls.maxPolarAngle=Math.PI*0.495; controls.minDistance=12; controls.maxDistance=220;
const hemi=new THREE.HemisphereLight(0xdfeeff,0x6b6a5a,0.5); scene.add(hemi);
const amb=new THREE.AmbientLight(0xffffff,0.08); scene.add(amb);
const sunL=new THREE.DirectionalLight(0xffffff,1);
sunL.castShadow=true; sunL.shadow.mapSize.set(4096,4096);
Object.assign(sunL.shadow.camera,{left:-66,right:66,top:66,bottom:-66,near:1,far:300});
sunL.shadow.bias=-0.0004; sunL.shadow.normalBias=0.04;
scene.add(sunL); scene.add(sunL.target);
const U={uHeat:{value:1},uDNI:{value:0},uDHI:{value:0},uGHI:{value:0},uMax:{value:1000}};
function geomFrom(vs,is){
  const q=b64(vs,Int16Array), idx=b64(is,Uint32Array), pos=new Float32Array(q.length);
  for(let i=0;i<q.length;i+=3){pos[i]=q[i]/100;pos[i+1]=q[i+2]/100;pos[i+2]=-q[i+1]/100;}
  const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setIndex(new THREE.BufferAttribute(idx,1));
  return g;
}
const GLSL_RAMP=`
vec3 heatRamp(float t){t=clamp(t,0.,1.);
 vec3 c0=vec3(.09,.10,.30),c1=vec3(.13,.42,.62),c2=vec3(.30,.74,.62),c3=vec3(.98,.84,.30),c4=vec3(.93,.36,.16),c5=vec3(.62,.07,.10);
 if(t<.2)return mix(c0,c1,t/.2); if(t<.45)return mix(c1,c2,(t-.2)/.25); if(t<.7)return mix(c2,c3,(t-.45)/.25); if(t<.88)return mix(c3,c4,(t-.7)/.18); return mix(c4,c5,(t-.88)/.12);}`;
function heatMat(color,opts){
  const m=new THREE.MeshPhongMaterial(Object.assign({color,shininess:0,specular:0x000000},opts||{}));
  m.onBeforeCompile=sh=>{
    Object.assign(sh.uniforms,U);
    sh.vertexShader=sh.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 vWN;")
      .replace("#include <beginnormal_vertex>","#include <beginnormal_vertex>\nvWN=normalize(mat3(modelMatrix)*objectNormal);");
    sh.fragmentShader=sh.fragmentShader.replace("#include <common>","#include <common>\nvarying vec3 vWN;uniform float uHeat,uDNI,uDHI,uGHI,uMax;"+GLSL_RAMP)
      .replace("#include <color_fragment>","#include <color_fragment>\nif(uHeat>.5)diffuseColor.rgb=vec3(1.);")
      .replace("#include <envmap_fragment>","#include <envmap_fragment>\nif(uHeat>.5){float d=reflectedLight.directDiffuse.r;vec3 n=normalize(vWN);float I=uDNI*d+uDHI*(.5+.5*n.y)+.2*uGHI*(.5-.5*n.y);outgoingLight=heatRamp(I/uMax);}");
  };
  return m;
}
const STY={ground:{c:0x8c9a6c},wall:{c:0xd9d6cf},slab:{c:0xc2bdb3},struct:{c:0x5f6872},roof:{c:0xf1efe8},
  poly:{c:0xd5e7ea,t:.55},glass:{c:0x8fbfd2,t:.35},mesh:{c:0x3d4245,t:.65},misc:{c:0xbcb5a8}};
const bmats=[]; let roofMat=null;
for(const [k,g] of Object.entries(MODEL.groups)){
  const s=STY[k]||STY.misc;
  const geo=geomFrom(g.v,g.i).toNonIndexed(); geo.computeVertexNormals();
  const m=heatMat(s.c,s.t?{transparent:true,opacity:s.t,depthWrite:false}:{});
  m.userData={baseOpacity:s.t||1,trans:!!s.t,base:s.c}; m.clippingPlanes=[clipPlane];
  const mesh=new THREE.Mesh(geo,m); mesh.castShadow=k!=="glass"; mesh.receiveShadow=true;
  scene.add(mesh); bmats.push(m); if(k==="roof") roofMat=m;
}
const gnd=new THREE.Mesh(new THREE.CircleGeometry(140,64).rotateX(-Math.PI/2),heatMat(0xa7ad96));
gnd.position.y=-0.76; gnd.receiveShadow=true; scene.add(gnd); gnd.material.userData={baseOpacity:1,ground:true}; bmats.push(gnd.material);
(function(){
  const c=document.createElement("canvas");c.width=c.height=128;const x=c.getContext("2d");
  x.fillStyle="#fff";x.beginPath();x.moveTo(64,6);x.lineTo(94,74);x.lineTo(64,58);x.lineTo(34,74);x.closePath();x.fill();
  x.font="600 44px sans-serif";x.textAlign="center";x.fillText("N",64,118);
  const sp=new THREE.Mesh(new THREE.PlaneGeometry(6,6).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false}));
  sp.position.set(-34,-0.7,-26); scene.add(sp);
})();
const zoneGroup=new THREE.Group(); scene.add(zoneGroup);
const zmeshes=zones.map((z,i)=>{
  const g=geomFrom(z.v,z.i); g.computeVertexNormals();
  const m=new THREE.MeshLambertMaterial({color:0x888888,transparent:true,opacity:.78,side:THREE.DoubleSide,depthWrite:false});
  const mesh=new THREE.Mesh(g,m); mesh.userData.zi=i; mesh.renderOrder=2;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g,25),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.55})));
  zoneGroup.add(mesh); return mesh;
});
function makeTiles(list,size,yoff){
  const n=list.length, pos=new Float32Array(n*12), col=new Float32Array(n*12), ind=new Uint32Array(n*6), s=size/2;
  list.forEach((p,k)=>{const c=[[p[0]-s,p[1]-s],[p[0]+s,p[1]-s],[p[0]+s,p[1]+s],[p[0]-s,p[1]+s]];
    c.forEach((q,j)=>pos.set([q[0],p[2]+yoff,-q[1]],(k*4+j)*3)); ind.set([k*4,k*4+1,k*4+2,k*4,k*4+2,k*4+3],k*6);});
  const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setAttribute("color",new THREE.BufferAttribute(col,3)); g.setIndex(new THREE.BufferAttribute(ind,1));
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2}));
  m.renderOrder=3; return m;
}
function paintTiles(mesh,ids,colFn){const col=mesh.geometry.attributes.color;ids.forEach((i,k)=>{const c=colFn(i);for(let q=0;q<4;q++)col.setXYZ(k*4+q,c[0],c[1],c[2]);});col.needsUpdate=true;}
const luxGroup=new THREE.Group(); scene.add(luxGroup);
const luxMeshes={}, luxIdx={1:[],2:[],3:[]}, nzMeshes={};
for(let i=0;i<ND;i++) luxIdx[dLvl[i]].push(i);
const ptXYZ=i=>[dP[i*3]/100,dP[i*3+1]/100,dP[i*3+2]/100];
const noiseGroup=new THREE.Group(); scene.add(noiseGroup);
for(const L of [1,2,3]){
  luxMeshes[L]=makeTiles(luxIdx[L].map(ptXYZ),0.94,0); luxGroup.add(luxMeshes[L]);
  nzMeshes[L]=makeTiles(luxIdx[L].map(ptXYZ),0.94,0.45); noiseGroup.add(nzMeshes[L]);
}
const sunBall=new THREE.Mesh(new THREE.SphereGeometry(2.2,24,16),new THREE.MeshBasicMaterial({color:0xffe6a0})); scene.add(sunBall);
let pathLine=null;
const ifc2three=v=>new THREE.Vector3(v.x,v.z,-v.y);
function buildPath(){
  if(pathLine){scene.remove(pathLine);pathLine.geometry.dispose();}
  const pts=[];for(let h=0;h<=24;h+=0.1){const s=sunAt(DOY[P.month],h);if(s.alt>-0.02)pts.push(ifc2three(s).multiplyScalar(85));}
  pathLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:0xffffff,dashSize:2,gapSize:1.5,transparent:true,opacity:.5}));
  pathLine.computeLineDistances(); scene.add(pathLine);
}

/* ================= konteks site: jalan raya, rel kereta, kendaraan ================= */
const NZ=MODEL.noise, NIN=NZ.nin, NSITE=NZ.ns;
const nzSite=b64(NZ.site,Int16Array);
const NZA={}, NZF={};
for(const k in NZ.A){const a=b64(NZ.A[k],Uint8Array),f=b64(NZ.Af[k],Uint8Array);NZA[k]=Float32Array.from(a,v=>-v/4);NZF[k]=Float32Array.from(f,v=>-v/4);}
const sitePts=[];for(let i=0;i<NSITE;i++)sitePts.push([nzSite[i*3]/100,nzSite[i*3+1]/100,-0.63]);
const siteTiles=makeTiles(sitePts,1.96,0); siteTiles.material.transparent=true; siteTiles.material.opacity=.82; noiseGroup.add(siteTiles);
const siteIds=sitePts.map((_,i)=>i);
const BBX=NZ.bb;
function siteXY(side,kind,s,l){
  const o=NZ.off[kind]+l;
  if(side==="S") return [s,BBX[1]-o];
  if(side==="N") return [s,BBX[3]+o];
  if(side==="E") return [BBX[2]+o,s];
  return [BBX[0]-o,s];
}
function sideYaw(side){return (side==="S"||side==="N")?0:Math.PI/2}
const siteGroup=new THREE.Group(); scene.add(siteGroup);
function lam(c){const m=new THREE.MeshLambertMaterial({color:c}); m.clippingPlanes=[clipPlane]; return m;}
function stripAt(side,kind,l,w,len,h,mat,y0){
  const m=new THREE.Mesh(new THREE.BoxGeometry(len,h,w),mat);
  const [x,y]=siteXY(side,kind,0,l); m.position.set(x,h/2+(y0===undefined?-0.72:y0),-y); m.rotation.y=sideYaw(side); m.receiveShadow=true; return m;
}
const vehMeshes={}, VT={
  motor:{len:1.9,w:0.7,h:1.25,max:80,col:[0x2b2f36,0x8a1c1c,0x1d3f7a,0x111111,0x5d6168]},
  mobil:{len:4.3,w:1.75,h:1.5,max:50,col:[0xf2f2f0,0xb8bcc2,0x1b1c1f,0x8e1b1b,0x3c4f6b,0xd8d2c4]},
  bus:{len:12,w:2.5,h:3.2,max:10,col:[0x1f5fa8,0xd86a1f,0xe9e7e0]}
};
const dummy=new THREE.Object3D(), tmpCol=new THREE.Color();
for(const [k,tt] of Object.entries(VT)){
  const g=new THREE.BoxGeometry(tt.len,tt.h,tt.w); g.translate(0,tt.h/2,0);
  const m=new THREE.InstancedMesh(g,new THREE.MeshLambertMaterial({color:0xffffff}),tt.max);
  m.castShadow=true; m.count=0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); vehMeshes[k]=m;
}
const trainMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(19.6,3.7,2.9).translate(0,1.85+0.9,0),new THREE.MeshLambertMaterial({color:0xf3f3ef}),8);
const trainStripe=new THREE.InstancedMesh(new THREE.BoxGeometry(19.7,0.45,2.95).translate(0,2.0,0),new THREE.MeshLambertMaterial({color:0xc4262e}),8);
const trainWin=new THREE.InstancedMesh(new THREE.BoxGeometry(19.0,0.9,2.96).translate(0,3.1,0),new THREE.MeshLambertMaterial({color:0x22313d}),8);
[trainMesh,trainStripe,trainWin].forEach(m=>{m.castShadow=true;m.frustumCulled=false;m.count=8;scene.add(m);});
function parkTrain(){dummy.position.set(0,-500,0);dummy.rotation.set(0,0,0);dummy.updateMatrix();[trainMesh,trainStripe,trainWin].forEach(m=>{for(let c=0;c<8;c++)m.setMatrixAt(c,dummy.matrix);m.instanceMatrix.needsUpdate=true;});}
parkTrain();
let SIDE="W", roadMesh=null;
function buildSite(side){
  SIDE=side; while(siteGroup.children.length){const c=siteGroup.children.pop();c.geometry&&c.geometry.dispose();}
  const L=320;
  roadMesh=stripAt(side,"road",0,8.8,L,0.06,lam(0x3a3d42),-0.6); siteGroup.add(roadMesh);
  siteGroup.add(stripAt(side,"road",5.6,2.4,L,0.25,lam(0xb9b4aa),-0.72));
  for(let s=-L/2;s<L/2;s+=9){ const m=new THREE.Mesh(new THREE.BoxGeometry(3,0.02,0.15),lam(0xf2efe6)); const [x,y]=siteXY(side,"road",s,0); m.position.set(x,-0.53,-y); m.rotation.y=sideYaw(side); siteGroup.add(m); }
  for(const l of [-4.2,4.2]) siteGroup.add(stripAt(side,"road",l,0.15,L,0.02,lam(0xf2efe6),-0.54));
  siteGroup.add(stripAt(side,"rail",0,9,L,0.35,lam(0x8b8478)));
  const sleepers=new THREE.InstancedMesh(new THREE.BoxGeometry(0.25,0.16,2.6),lam(0x6e6a64),2*Math.ceil(L/0.75));
  let n=0; for(const tr of [-2.2,2.2]) for(let s=-L/2;s<L/2;s+=0.75){const [x,y]=siteXY(side,"rail",s,tr);dummy.position.set(x,-0.3,-y);dummy.rotation.set(0,sideYaw(side),0);dummy.updateMatrix();sleepers.setMatrixAt(n++,dummy.matrix);}
  sleepers.count=n; siteGroup.add(sleepers);
  for(const tr of [-2.2,2.2]) for(const g of [-0.72,0.72]) siteGroup.add(stripAt(side,"rail",tr+g,0.08,L,0.15,lam(0x9aa0a6),-0.25));
  for(let s=-L/2+10;s<L/2;s+=50){
    const [x,y]=siteXY(side,"rail",s,4.4); const pole=new THREE.Mesh(new THREE.BoxGeometry(0.3,7.5,0.3),lam(0x7d8389)); pole.position.set(x,3.0,-y); pole.castShadow=true; siteGroup.add(pole);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.15,5.4),lam(0x7d8389)); const [ax,ay]=siteXY(side,"rail",s,1.9); arm.position.set(ax,6.5,-ay); arm.rotation.y=sideYaw(side); siteGroup.add(arm);
  }
  for(const tr of [-2.2,2.2]) siteGroup.add(stripAt(side,"rail",tr,0.03,L,0.03,lam(0x2b2b2b),6.1));
  initTraffic(); placeBell();
}

/* ---- objek 3D solusi desain ---- */
const SOL3D={};
function hiMat(c,opts){const m=new THREE.MeshLambertMaterial(Object.assign({color:c},opts||{})); m.clippingPlanes=[clipPlane]; return m;}
(function buildSolutionObjects(){
  // sirip vertikal fasad barat
  let g=new THREE.Group();
  const fins=new THREE.InstancedMesh(new THREE.BoxGeometry(0.6,9.4,0.07),hiMat(0xd8cdb8),40); let n=0;
  for(let y=-7.1;y<=3.25;y+=0.6){dummy.position.set(-21.75,5.0,-y);dummy.rotation.set(0,0,0);dummy.updateMatrix();fins.setMatrixAt(n++,dummy.matrix);}
  fins.count=n; fins.castShadow=true; g.add(fins); SOL3D.louver=g;
  // pohon peneduh di jalur hijau depan fasad
  g=new THREE.Group();
  const trunkM=hiMat(0x6b4f3a), leafM=hiMat(0x4c7d3c), planterM=hiMat(0x8a7f70);
  const planter=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.5,26),planterM); planter.position.set(-22.15,-0.45,0); planter.receiveShadow=true; g.add(planter);
  for(let y=-12;y<=12.1;y+=6){
    const tr=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.22,4.2,8),trunkM); tr.position.set(-22.15,1.4,-y); tr.castShadow=true; g.add(tr);
    const cn=new THREE.Mesh(new THREE.IcosahedronGeometry(2.6,1),leafM); cn.position.set(-22.15,5.6,-y); cn.scale.set(1,0.78,1); cn.castShadow=true; g.add(cn);
    const sh=new THREE.Mesh(new THREE.IcosahedronGeometry(0.7,0),leafM); sh.position.set(-22.15,0.2,-y-3); g.add(sh);
  }
  SOL3D.trees=g;
  // dinding peredam di sisi rel
  g=new THREE.Group();
  const wall=new THREE.Mesh(new THREE.BoxGeometry(0.3,3,320),hiMat(0x9fae9c)); wall.position.set(-38,0.78,0); wall.castShadow=true; wall.receiveShadow=true; g.add(wall);
  const cap=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.12,320),hiMat(0x6f7c6c)); cap.position.set(-38,2.34,0); g.add(cap);
  SOL3D.railwall=g;
  // kaca laminasi fasad barat
  g=new THREE.Group();
  const gl=new THREE.Mesh(new THREE.PlaneGeometry(10.4,9.4),hiMat(0x7fb6d6,{transparent:true,opacity:.38,depthWrite:false,side:THREE.DoubleSide}));
  gl.rotation.y=-Math.PI/2; gl.position.set(-21.35,5.0,1.95); g.add(gl);
  const frame=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.02,9.4,10.4)),new THREE.LineBasicMaterial({color:0xcfe6f2}));
  frame.position.set(-21.35,5.0,1.95); g.add(frame);
  SOL3D.glazing=g;
  // kipas plafon
  g=new THREE.Group(); const fanPts=[]; const used=new Set();
  for(let i=0;i<ND;i++){ if(!dIn[i]) continue; const x=dP[i*3]/100, y=dP[i*3+1]/100, k=dLvl[i]+":"+Math.round(x/6)+":"+Math.round(y/5); if(used.has(k)) continue; used.add(k); fanPts.push([x,y,dP[i*3+2]/100+2.45]); }
  const blades=new THREE.InstancedMesh(new THREE.BoxGeometry(1.5,0.03,0.16),hiMat(0x3a3f44),fanPts.length*2);
  blades.instanceMatrix.setUsage(THREE.DynamicDrawUsage); blades.frustumCulled=false; g.add(blades);
  g.userData={pts:fanPts,blades}; SOL3D.fans=g;
  for(const k in SOL3D){SOL3D[k].visible=false; scene.add(SOL3D[k]);}
})();
let fanAng=0;
function stepFans(dt){
  const g=SOL3D.fans; if(!g.visible) return; fanAng+=dt*7;
  const {pts,blades}=g.userData; let n=0;
  for(const p of pts) for(const a of [0,Math.PI/2]){dummy.position.set(p[0],p[2],-p[1]);dummy.rotation.set(0,fanAng+a+p[0],0);dummy.updateMatrix();blades.setMatrixAt(n++,dummy.matrix);}
  blades.instanceMatrix.needsUpdate=true;
}
function applySolutions3D(){
  for(const k in SOL3D) SOL3D[k].visible=ON.has(k);
  if(roadMesh) roadMesh.material.color.setHex(ON.has("asphalt")?0x24272b:0x3a3d42);
  if(roofMat){roofMat.color.setHex(ON.has("roof")?0xe4f1f6:roofMat.userData.base);}
}
let hlTimer=null;
function highlightSol(id,on){
  const g=SOL3D[id]; if(!g) return;
  g.traverse(o=>{if(o.material&&o.material.emissive) o.material.emissive.setHex(on?0x0b5a4c:0x000000);});
}

/* ---- lalu lintas ---- */
const QH=[700,500,400,400,600,1500,3200,4200,4300,3500,3000,3000,3100,3000,3100,3400,3900,4400,4300,3600,2900,2300,1700,1100].map(q=>Math.round(q*0.6));
const NTR=[4,0,0,0,4,10,16,20,20,16,12,12,12,12,12,14,18,20,20,16,12,10,8,6];
const hourly=(a,h)=>{const i=Math.floor(h)%24,f=h-Math.floor(h);return a[i]*(1-f)+a[(i+1)%24]*f};
let vehicles=[], train=null, trainTimer=8, vid=0, trainParked=true;
const ROADL=150;
function newVehicle(sStart){
  const r=Math.random(), type=r<0.58?"motor":r<0.93?"mobil":"bus", tt=VT[type], dir=Math.random()<0.5?1:-1;
  const lane=(dir>0?1:-1)*(type==="motor"?(0.7+Math.random()*3.2):2.2);
  const v=(type==="bus"?9:type==="mobil"?11:12)*(0.8+Math.random()*0.4)*(hourly(QH,hour)>4000?0.7:1);
  return {id:vid++,type,dir,lane,v,s:sStart!==undefined?sStart:-dir*ROADL,col:tt.col[Math.floor(Math.random()*tt.col.length)]};
}
function targetCount(){return Math.round(hourly(QH,hour)*P.traffic*0.0085)}
function initTraffic(){vehicles=[];const n=targetCount();for(let i=0;i<n;i++)vehicles.push(newVehicle(-ROADL+Math.random()*2*ROADL));}
function spawnTrain(){const dir=Math.random()<0.5?1:-1;train={dir,track:dir>0?-2.2:2.2,v:15+Math.random()*3,head:-dir*(ROADL+20),len:8*20,horn:false};}
function stepTraffic(dt){
  for(const v of vehicles){
    let sp=v.v;
    for(const o of vehicles){ if(o!==v&&o.dir===v.dir&&Math.abs(o.lane-v.lane)<1.2){const d=(o.s-v.s)*v.dir; if(d>0&&d<VT[v.type].len/2+VT[o.type].len/2+3) sp=Math.min(sp,o.v*0.9);} }
    v.s+=sp*v.dir*dt; v.cv=sp;
  }
  const tc=targetCount();
  vehicles=vehicles.filter(v=>Math.abs(v.s)<=ROADL+5);
  while(vehicles.length<tc&&Math.random()<dt*3) vehicles.push(newVehicle());
  const N=hourly(NTR,hour);
  if(!train){ trainTimer-=dt; if(N>0.5&&trainTimer<=0){spawnTrain(); trainTimer=Math.max(25,900/N)*(0.7+Math.random()*0.6);} }
  else { train.head+=train.v*train.dir*dt; if(train.dir*(train.head)-train.len>ROADL+20) train=null; }
  const cnt={motor:0,mobil:0,bus:0};
  for(const v of vehicles){ const m=vehMeshes[v.type], k=cnt[v.type]++; if(k>=VT[v.type].max) continue;
    const [x,y]=siteXY(SIDE,"road",v.s,v.lane); dummy.position.set(x,-0.54,-y); dummy.rotation.set(0,sideYaw(SIDE)+(v.dir<0?Math.PI:0),0); dummy.updateMatrix();
    m.setMatrixAt(k,dummy.matrix); m.setColorAt(k,tmpCol.setHex(v.col)); }
  for(const k in cnt){vehMeshes[k].count=Math.min(cnt[k],VT[k].max); vehMeshes[k].instanceMatrix.needsUpdate=true; if(vehMeshes[k].instanceColor) vehMeshes[k].instanceColor.needsUpdate=true;}
  if(train){ for(let c=0;c<8;c++){ const sc=train.head-train.dir*(c*20+10); const [x,y]=siteXY(SIDE,"rail",sc,train.track);
      dummy.position.set(x,-0.95,-y); dummy.rotation.set(0,sideYaw(SIDE),0); dummy.updateMatrix(); [trainMesh,trainStripe,trainWin].forEach(m=>m.setMatrixAt(c,dummy.matrix)); }
    [trainMesh,trainStripe,trainWin].forEach(m=>{m.instanceMatrix.needsUpdate=true;}); trainParked=false; }
  else if(trainParked===false){parkTrain();trainParked=true;}
}
function trainPresence(){ if(!train) return 0; const a=train.head, b=train.head-train.dir*train.len; const lo=Math.max(-100,Math.min(a,b)), hi=Math.min(100,Math.max(a,b)); return Math.max(0,hi-lo)/train.len; }

/* ---- model bising ---- */
const LW_RAIL_MAX=99;
const lwRoad=h=>48+10*Math.log10(Math.max(1,hourly(QH,h)*P.traffic));
const lwRailEq=h=>{const n=hourly(NTR,h);return n<0.05?-99:LW_RAIL_MAX+10*Math.log10(n*15/3600)};
const NALL=NIN+NSITE, nzNow=new Float32Array(NALL);
const ptX=i=>i<NIN?dP[i*3]/100:sitePts[i-NIN][0], ptY=i=>i<NIN?dP[i*3+1]/100:sitePts[i-NIN][1], ptL=i=>i<NIN?dLvl[i]:1;
function noiseAdj(S){
  const road=new Float32Array(NALL), rail=new Float32Array(NALL);
  const Ar=NZA.Wroad, Fr=NZF.Wroad, Al=NZA.Wrail, Fl=NZF.Wrail;
  for(let i=0;i<NALL;i++){
    const x=ptX(i), y=ptY(i), lv=ptL(i);
    if(S.has("asphalt")) road[i]-=3;
    if(S.has("trees")&&x>-23.5&&Math.abs(y)<15){road[i]-=1; rail[i]-=0.5;}
    if(S.has("railwall")&&x>-38) rail[i]-=[0,8,5,3][lv];
    if(S.has("glazing")&&i<NIN&&dIn[i]){
      const k=x<0?0.8:0.4;
      road[i]-=Math.max(0,25-(Fr[i]-Ar[i]))*k;
      rail[i]-=Math.max(0,25-(Fl[i]-Al[i]))*k;
    }
  }
  return {road,rail};
}
function noiseAt(h,railMode,out,adj){
  const Ar=NZA[SIDE+"road"], Al=NZA[SIDE+"rail"], lr=lwRoad(h);
  const ll=railMode==="eq"?lwRailEq(h):(railMode>0?LW_RAIL_MAX+10*Math.log10(railMode):-99);
  const ar=adj.road, al=adj.rail;
  for(let i=0;i<NALL;i++) out[i]=10*Math.log10(Math.pow(10,(lr+Ar[i]+ar[i])/10)+Math.pow(10,(ll+Al[i]+al[i])/10));
  return out;
}
const facadeIdx=[]; for(let i=0;i<NSITE;i++){const x=sitePts[i][0],y=sitePts[i][1]; if(x>-22.8&&x<-18.4&&Math.abs(y)<BBX[3]) facadeIdx.push(NIN+i);}
const laeq=(arr,a,b)=>{let s=0;for(let h=a;h<b;h++)s+=Math.pow(10,arr[h]/10);return 10*Math.log10(s/(b-a));};
function computeNoise(S){
  const adj=noiseAdj(S);
  const tmp=new Float32Array(NALL), fac=new Float64Array(24), ins=new Float64Array(24), over=new Float64Array(24);
  for(let h=0;h<24;h++){
    noiseAt(h+0.5,"eq",tmp,adj); let f=0,s=0,o=0;
    facadeIdx.forEach(i=>f=Math.max(f,tmp[i]));
    for(let i=0;i<NIN;i++) if(dIn[i]){s+=tmp[i]; if(tmp[i]>55)o++;}
    fac[h]=f; ins[h]=s/inPts; over[h]=o/inPts;
  }
  noiseAt(14,1,tmp,adj); let mx=0; for(let i=0;i<NIN;i++) if(dIn[i]) mx+=tmp[i]; mx/=inPts;
  const zins=zones.map(()=>[0,0]); const Ar=NZA[SIDE+"road"], Af=NZF[SIDE+"road"];
  for(let i=0;i<NIN;i++){const z=zins[dZone[i]]; z[0]+=Ar[i]+adj.road[i]-Af[i]; z[1]++;}
  noiseAt(13,"eq",tmp,adj); const zl=zones.map(()=>[0,0]); for(let i=0;i<NIN;i++){const z=zl[dZone[i]];z[0]+=Math.pow(10,tmp[i]/10);z[1]++;}
  return {adj,fac,ins,over,lmaxIn:mx,facDay:laeq(fac,6,22),insDay:laeq(ins,6,22),
    zins:zins.map(z=>z[1]?z[0]/z[1]:0),zinsL:zl.map(z=>z[1]?10*Math.log10(z[0]/z[1]):0)};
}
const NZBANDS=[[35,[.72,.86,.55]],[40,[.33,.69,.30]],[45,[.10,.48,.20]],[50,[.98,.92,.35]],[55,[.85,.66,.20]],[60,[.97,.45,.17]],[65,[.86,.15,.17]],[70,[.62,.10,.32]],[75,[.52,.36,.68]],[80,[.15,.32,.62]],[999,[.09,.13,.36]]];
function dbCol(L){for(const b of NZBANDS) if(L<b[0]) return b[1]; return NZBANDS[NZBANDS.length-1][1];}

/* ---- suara 3D (Web Audio, HRTF) ---- */
const AU={on:false};
function noiseBuf(ctx,kind){
  const n=ctx.sampleRate*4, b=ctx.createBuffer(1,n,ctx.sampleRate), d=b.getChannelData(0);
  let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0,last=0;
  for(let i=0;i<n;i++){const w=Math.random()*2-1;
    if(kind==="pink"){b0=.99886*b0+w*.0555179;b1=.99332*b1+w*.0750759;b2=.969*b2+w*.153852;b3=.8665*b3+w*.3104856;b4=.55*b4+w*.5329522;b5=-.7616*b5-w*.016898;d[i]=(b0+b1+b2+b3+b4+b5+b6+w*.5362)*.11;b6=w*.115926;}
    else if(kind==="brown"){last=(last+.02*w)/1.02;d[i]=last*3.5;} else d[i]=w;}
  return b;
}
function loopSrc(buf){const s=AU.ctx.createBufferSource();s.buffer=buf;s.loop=true;s.start(0,Math.random()*3.5);return s;}
function mkPanner(ref,roll,light){const p=AU.ctx.createPanner();p.panningModel=light?"equalpower":"HRTF";p.distanceModel="inverse";p.refDistance=ref;p.rolloffFactor=roll;p.maxDistance=600;p.connect(AU.insul);return p;}
function setPos(p,v,tc){const tt=AU.ctx.currentTime;if(p.positionX){p.positionX.setTargetAtTime(v.x,tt,tc);p.positionY.setTargetAtTime(v.y,tt,tc);p.positionZ.setTargetAtTime(v.z,tt,tc);}else p.setPosition(v.x,v.y,v.z);}
function audioStart(){
  if(AU.ctx){AU.ctx.resume();AU.on=true;return;}
  const ctx=new (window.AudioContext||window.webkitAudioContext)(); AU.ctx=ctx;
  AU.master=ctx.createGain(); AU.master.gain.value=P.vol;
  const comp=ctx.createDynamicsCompressor(); comp.threshold.value=-14; comp.ratio.value=4;
  AU.insul=ctx.createBiquadFilter(); AU.insul.type="lowpass"; AU.insul.frequency.value=18000; AU.insul.Q.value=0.5;
  AU.insGain=ctx.createGain(); AU.insul.connect(AU.insGain); AU.insGain.connect(AU.master); AU.master.connect(comp); comp.connect(ctx.destination);
  AU.pink=noiseBuf(ctx,"pink"); AU.brown=noiseBuf(ctx,"brown"); AU.white=noiseBuf(ctx,"white");
  const bed=loopSrc(AU.brown), bl=ctx.createBiquadFilter(); bl.type="lowpass"; bl.frequency.value=380; AU.bedGain=ctx.createGain(); AU.bedGain.gain.value=0;
  bed.connect(bl); bl.connect(AU.bedGain); AU.bedGain.connect(AU.insul);
  AU.voices=[];
  for(let i=0;i<8;i++){
    const osc=ctx.createOscillator(); osc.type="sawtooth"; osc.frequency.value=80;
    const lfo=ctx.createOscillator(); lfo.frequency.value=22; const lg=ctx.createGain(); lg.gain.value=0;
    const am=ctx.createGain(); am.gain.value=0.6; lfo.connect(lg); lg.connect(am.gain);
    const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=700;
    const src=loopSrc(AU.pink), bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=900; bp.Q.value=0.7;
    const og=ctx.createGain(), ng=ctx.createGain(), vg=ctx.createGain(); vg.gain.value=0;
    osc.connect(lp); lp.connect(am); am.connect(og); src.connect(bp); bp.connect(ng); og.connect(vg); ng.connect(vg);
    const pan=mkPanner(6,1.1); vg.connect(pan); osc.start(); lfo.start();
    AU.voices.push({osc,lfo,lg,lp,bp,og,ng,vg,pan,id:-1});
  }
  const r=loopSrc(AU.brown), rl=ctx.createBiquadFilter(); rl.type="lowpass"; rl.frequency.value=260;
  const q=loopSrc(AU.pink), qb=ctx.createBiquadFilter(); qb.type="bandpass"; qb.frequency.value=2600; qb.Q.value=3;
  AU.tRum=ctx.createGain(); AU.tSq=ctx.createGain(); AU.tRum.gain.value=0; AU.tSq.gain.value=0;
  AU.tPan=mkPanner(12,1.0); r.connect(rl); rl.connect(AU.tRum); AU.tRum.connect(AU.tPan); q.connect(qb); qb.connect(AU.tSq); AU.tSq.connect(AU.tPan);
  AU.bellPan=mkPanner(15,1.0,true); AU.hornPan=mkPanner(10,1.0,true); AU.nextBell=0; AU.lastClack=0; AU.lastUpd=0; placeBell(); AU.on=true;
}
function placeBell(){ if(!AU.bellPan) return; const [bx,by]=siteXY(SIDE,"rail",95,6); setPos(AU.bellPan,new THREE.Vector3(bx,3,-by),0.001); }
function audioStop(){ if(AU.ctx) AU.ctx.suspend(); AU.on=false; }
function clack(when,gain){
  const ctx=AU.ctx, s=ctx.createBufferSource(); s.buffer=AU.white; const bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=1500+Math.random()*500; bp.Q.value=1.4;
  const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(gain,when+0.004); g.gain.exponentialRampToValueAtTime(0.0001,when+0.09);
  const lo=ctx.createOscillator(); lo.frequency.value=95; const lg=ctx.createGain(); lg.gain.setValueAtTime(gain*0.9,when); lg.gain.exponentialRampToValueAtTime(0.0001,when+0.12);
  s.connect(bp); bp.connect(g); g.connect(AU.tPan); lo.connect(lg); lg.connect(AU.tPan); s.start(when,Math.random()*3,0.15); lo.start(when); lo.stop(when+0.15);
}
function horn(pan,when){
  const ctx=AU.ctx; [349,440].forEach(f=>{const o=ctx.createOscillator();o.type="sawtooth";o.frequency.value=f;const l=ctx.createBiquadFilter();l.type="lowpass";l.frequency.value=1800;const g=ctx.createGain();
    g.gain.setValueAtTime(0,when);g.gain.linearRampToValueAtTime(0.16,when+0.06);g.gain.setValueAtTime(0.16,when+1.1);g.gain.linearRampToValueAtTime(0,when+1.4);o.connect(l);l.connect(g);g.connect(pan);o.start(when);o.stop(when+1.5);});
}
function bellStrike(when){
  const ctx=AU.ctx; [[830,0.22],[2080,0.08],[3310,0.05]].forEach(([f,a])=>{const o=ctx.createOscillator();o.frequency.value=f;const g=ctx.createGain();
    g.gain.setValueAtTime(a,when);g.gain.exponentialRampToValueAtTime(0.0001,when+0.5);o.connect(g);g.connect(AU.bellPan);o.start(when);o.stop(when+0.55);});
}
const LF=new THREE.Vector3();
function listenerPos(){
  if(P.listen==="zona"&&selZone>=0){const z=zones[selZone];return new THREE.Vector3(z.c[0],z.c[2]-0.5,-z.c[1]);}
  return camera.position.clone();
}
function audioFrame(dt,prevTrainHead){
  if(!AU.on||!AU.ctx) return;
  const ctx=AU.ctx, tt=ctx.currentTime, Lp=listenerPos(), lis=ctx.listener;
  const upd=tt-AU.lastUpd>=0.05; if(upd) AU.lastUpd=tt;
  if(upd){
    camera.getWorldDirection(LF);
    if(P.listen==="zona"&&selZone>=0){const [x,y]=siteXY(SIDE,"road",0,0);LF.set(x-Lp.x,0,-y-Lp.z).normalize();}
    if(lis.positionX){lis.positionX.setTargetAtTime(Lp.x,tt,0.05);lis.positionY.setTargetAtTime(Lp.y,tt,0.05);lis.positionZ.setTargetAtTime(Lp.z,tt,0.05);
      lis.forwardX.setTargetAtTime(LF.x,tt,0.05);lis.forwardY.setTargetAtTime(LF.y,tt,0.05);lis.forwardZ.setTargetAtTime(LF.z,tt,0.05);}
    else {lis.setPosition(Lp.x,Lp.y,Lp.z);lis.setOrientation(LF.x,LF.y,LF.z,0,1,0);}
    let ins=0; if(P.listen==="zona"&&selZone>=0) ins=NOISE.zins[selZone];
    // solusi pada sumber (aspal, dinding rel) juga terdengar dari posisi kamera
    const src=(ON.has("asphalt")?-3:0)+(ON.has("railwall")&&train?-6:0);
    const tot=ins+src;
    AU.insul.frequency.setTargetAtTime(ins<-1?400+15600*Math.pow(10,ins/15):18000,tt,0.2);
    AU.insGain.gain.setTargetAtTime(Math.pow(10,tot/20*0.8),tt,0.2);
    AU.master.gain.setTargetAtTime(P.vol,tt,0.1);
    AU.bedGain.gain.setTargetAtTime(0.05*Math.sqrt(hourly(QH,hour)*P.traffic/3000),tt,0.5);
    const near=vehicles.map(v=>{const [x,y]=siteXY(SIDE,"road",v.s,v.lane);const p=new THREE.Vector3(x,0.4,-y);return {v,p,d:p.distanceTo(Lp)};}).sort((a,b)=>a.d-b.d).slice(0,8);
    const byId=new Map(near.map(n=>[n.v.id,n])), taken=new Set();
    AU.voices.forEach(vo=>{ if(byId.has(vo.id)) taken.add(vo.id); else vo.id=-1; });
    const pending=near.filter(n=>!taken.has(n.v.id));
    AU.voices.forEach(vo=>{
      let n=vo.id>=0?byId.get(vo.id):null, fresh=false;
      if(!n){ n=pending.shift(); if(!n){vo.vg.gain.setTargetAtTime(0,tt,0.25);return;} vo.id=n.v.id; fresh=true; }
      const v=n.v;
      const [dx,dy]=(SIDE==="S"||SIDE==="N")?[v.dir,0]:[0,v.dir]; const vel=new THREE.Vector3(dx*v.cv,0,-dy*v.cv);
      const toL=Lp.clone().sub(n.p).normalize(), vr=vel.dot(toL), dop=343/(343-vr);
      const base=v.type==="motor"?{f:96,g:0.55,n:0.35,am:0.35,bp:1300}:v.type==="mobil"?{f:52,g:0.35,n:0.55,am:0.05,bp:850}:{f:38,g:0.8,n:0.9,am:0.1,bp:600};
      vo.osc.frequency.setTargetAtTime(base.f*dop*(0.9+0.2*((v.id%7)/7)),tt,0.06);
      vo.bp.frequency.setTargetAtTime(base.bp*dop,tt,0.06);
      if(fresh){ vo.lg.gain.setValueAtTime(base.am,tt); vo.lfo.frequency.setValueAtTime(v.type==="motor"?24:12,tt);
        vo.og.gain.setValueAtTime(base.g*0.35,tt); vo.ng.gain.setValueAtTime(base.n,tt); setPos(vo.pan,n.p,0.001); vo.vg.gain.setTargetAtTime(0.6,tt,0.35); }
      else { setPos(vo.pan,n.p,0.06); }
    });
  }
  if(train){
    const ax=(SIDE==="S"||SIDE==="N"), sL=ax?Lp.x:-Lp.z; const lo=Math.min(train.head,train.head-train.dir*train.len), hi=Math.max(train.head,train.head-train.dir*train.len);
    const sc=Math.max(lo,Math.min(hi,sL)); const [x,y]=siteXY(SIDE,"rail",sc,train.track); const tp=new THREE.Vector3(x,1.2,-y);
    if(upd){ setPos(AU.tPan,tp,0.06); AU.tRum.gain.setTargetAtTime(0.9,tt,0.4); AU.tSq.gain.setTargetAtTime(0.05,tt,0.4); }
    if(!train.horn&&Math.abs(train.head-sL)<140){train.horn=true;const [hx,hy]=siteXY(SIDE,"rail",train.head,train.track);setPos(AU.hornPan,new THREE.Vector3(hx,3,-hy),0.001);horn(AU.hornPan,tt+0.05);}
    if(prevTrainHead!==null) for(let c=0;c<8;c++) for(const off of [2.2,4.6,15.4,17.8]){
      const p1=prevTrainHead-train.dir*(c*20+off), p2=train.head-train.dir*(c*20+off);
      if((p1-sL)*(p2-sL)<=0&&tt-AU.lastClack>0.045){clack(tt+0.01,0.5);AU.lastClack=tt;}
    }
    if(Math.abs(train.head-95)<170||(lo<95&&hi>95)){ if(tt>=AU.nextBell){bellStrike(tt+0.02);AU.nextBell=tt+0.55;} }
  } else if(upd){ AU.tRum.gain.setTargetAtTime(0,tt,0.8); AU.tSq.gain.setTargetAtTime(0,tt,0.5); }
}

/* ================= aliran udara (Lattice Boltzmann D2Q9) ================= */
const AIR=MODEL.air, NX=AIR.nx, NY=AIR.ny, NC=NX*NY, CS=AIR.cs;
const U0=0.08, HF=[0,0.62,0.72,0.8];
/* kernel D2Q9: tumbukan BGK + streaming dengan bounce-back, dibuka penuh agar cepat.
   Fungsi ini juga dikirim ke Web Worker, jadi tidak boleh memakai variabel dari luar. */
function lbmSteps(A,B,SOL,NX,NY,wu,wv,steps,UX,UY){
  const NC=NX*NY, om=1/0.56, uu0=1.5*(wu*wu+wv*wv), fe=new Float64Array(9);
  const EXk=[0,1,0,-1,0,1,-1,-1,1], EYk=[0,0,1,0,-1,1,1,-1,-1], WTk=[4/9,1/9,1/9,1/9,1/9,1/36,1/36,1/36,1/36];
  for(let k=0;k<9;k++){const e=3*(EXk[k]*wu+EYk[k]*wv);fe[k]=WTk[k]*(1+e+0.5*e*e-uu0);}
  for(let s=0;s<steps;s++){
    for(let j=0;j<NY;j++){ const edgeJ=j<2||j>=NY-2;
      for(let i=0;i<NX;i++){
        const c=j*NX+i; if(SOL[c]===1) continue;
        let f0,f1,f2,f3,f4,f5,f6,f7,f8,u,v;
        if(edgeJ||i<2||i>=NX-2){f0=fe[0];f1=fe[1];f2=fe[2];f3=fe[3];f4=fe[4];f5=fe[5];f6=fe[6];f7=fe[7];f8=fe[8];u=wu;v=wv;}
        else{
          f0=A[c];f1=A[NC+c];f2=A[2*NC+c];f3=A[3*NC+c];f4=A[4*NC+c];f5=A[5*NC+c];f6=A[6*NC+c];f7=A[7*NC+c];f8=A[8*NC+c];
          let rho=f0+f1+f2+f3+f4+f5+f6+f7+f8;
          if(rho>0.3&&rho<3){u=(f1-f3+f5-f6-f7+f8)/rho;v=(f2-f4+f5+f6-f7-f8)/rho;}else{rho=1;u=0;v=0;}
          const sp2=u*u+v*v; if(sp2>0.09){const k=0.3/Math.sqrt(sp2);u*=k;v*=k;}
          if(SOL[c]===2){u*=0.55;v*=0.55;}
          const uu=1.5*(u*u+v*v), r9=rho*4/9, r1=rho/9, r36=rho/36; let e;
          f0+=om*(r9*(1-uu)-f0);
          e=3*u; f1+=om*(r1*(1+e+0.5*e*e-uu)-f1);
          e=3*v; f2+=om*(r1*(1+e+0.5*e*e-uu)-f2);
          e=-3*u; f3+=om*(r1*(1+e+0.5*e*e-uu)-f3);
          e=-3*v; f4+=om*(r1*(1+e+0.5*e*e-uu)-f4);
          e=3*(u+v); f5+=om*(r36*(1+e+0.5*e*e-uu)-f5);
          e=3*(v-u); f6+=om*(r36*(1+e+0.5*e*e-uu)-f6);
          e=-3*(u+v); f7+=om*(r36*(1+e+0.5*e*e-uu)-f7);
          e=3*(u-v); f8+=om*(r36*(1+e+0.5*e*e-uu)-f8);
        }
        UX[c]=u;UY[c]=v;
        const iE=i<NX-1, iW=i>0, jN=j<NY-1, jS=j>0;
        B[c]=f0;
        if(iE){const n=c+1; if(SOL[n]===1) B[3*NC+c]=f1; else B[NC+n]=f1;}
        if(jN){const n=c+NX; if(SOL[n]===1) B[4*NC+c]=f2; else B[2*NC+n]=f2;}
        if(iW){const n=c-1; if(SOL[n]===1) B[NC+c]=f3; else B[3*NC+n]=f3;}
        if(jS){const n=c-NX; if(SOL[n]===1) B[2*NC+c]=f4; else B[4*NC+n]=f4;}
        if(iE&&jN){const n=c+NX+1; if(SOL[n]===1) B[7*NC+c]=f5; else B[5*NC+n]=f5;}
        if(iW&&jN){const n=c+NX-1; if(SOL[n]===1) B[8*NC+c]=f6; else B[6*NC+n]=f6;}
        if(iW&&jS){const n=c-NX-1; if(SOL[n]===1) B[5*NC+c]=f7; else B[7*NC+n]=f7;}
        if(iE&&jS){const n=c-NX+1; if(SOL[n]===1) B[6*NC+c]=f8; else B[8*NC+n]=f8;}
      }
    }
    const tmp=A;A=B;B=tmp;
  }
  return [A,B];
}
function lbmInit(F,SOL,wu,wv){
  const uu=1.5*(wu*wu+wv*wv), EXk=[0,1,0,-1,0,1,-1,-1,1], EYk=[0,0,1,0,-1,1,1,-1,-1], WTk=[4/9,1/9,1/9,1/9,1/9,1/36,1/36,1/36,1/36];
  const fo=new Float64Array(9); for(let k=0;k<9;k++){const e=3*(EXk[k]*wu+EYk[k]*wv);fo[k]=WTk[k]*(1+e+0.5*e*e-uu);}
  for(let c=0;c<NC;c++){ if(SOL[c]===1){for(let k=0;k<9;k++)F[k*NC+c]=WTk[k];} else for(let k=0;k<9;k++)F[k*NC+c]=fo[k]; }
}
const levelGrids=AIR.levels.map(L=>({g:b64(L.g,Uint8Array),z:b64(L.zid,Uint8Array),y:L.z}));
const gi=x=>Math.round((x-AIR.ox)/CS), gj=y=>Math.round((y-AIR.oy)/CS);
/* grid rintangan per lantai dengan solusi desain */
function airGrid(level,S){
  const L=levelGrids[level-1], SOL=new Uint8Array(L.g), ZID=Array.from(L.z,v=>v===255?255:byModelIdx[v]);
  const inside=c=>ZID[c]!==255&&!zones[ZID[c]].outdoor&&SOL[c]!==1;
  let x0=1e9,x1=-1,y0=1e9,y1=-1;
  for(let c=0;c<NC;c++) if(ZID[c]!==255){const i=c%NX,j=(c/NX)|0;x0=Math.min(x0,i);x1=Math.max(x1,i);y0=Math.min(y0,j);y1=Math.max(y1,j);}
  if(S.has("cross")) for(let j=y0-3;j<=y1+3;j++) for(let i=x0-3;i<=x1+3;i++){const c=j*NX+i; if(SOL[c]===2&&(((i>>2)+(j>>2))&1)) SOL[c]=0;}
  if(S.has("glazing")) for(let j=0;j<NY;j++) for(let i=0;i<NX;i++){const c=j*NX+i; if(inside(c)){SOL[c]=1;break;} if(SOL[c]===1&&ZID[c]!==255) break;}
  if(S.has("trees")) for(let y=-12;y<=12;y+=0.5){const j=gj(y); for(let i=gi(-23.2);i<=gi(-21.6);i++){const c=j*NX+i; if(level>1){if(SOL[c]===0)SOL[c]=2;} else if(Math.abs((y+12)%6)<0.3&&i===gi(-22.2)) SOL[c]=1;}}
  if(S.has("railwall")&&level===1) for(let j=2;j<NY-2;j++) SOL[j*NX+gi(-38)]=1;
  const INM=new Uint8Array(NC); for(let c=0;c<NC;c++) INM[c]=inside(c)?1:0;
  return {SOL,ZID,INM,bb:{x0,x1,y0,y1}};
}
const airSetKey=S=>AIRSOL.filter(k=>S.has(k)).join(",");
const airKey=(level,dir,S)=>level+"|"+dir+"|"+airSetKey(S);
const NB4=[[1,0],[-1,0],[0,1],[0,-1]];
const HOPEN=2.4;
function airStatsFrom(level,G,UX,UY){
  const toM=s=>s/U0*P.wind*HF[level];
  const zs=zones.map(()=>({s:0,n:0,qin:0})); const bins=[0,0,0,0,0]; let n=0,s=0,qin=0;
  for(let c=0;c<NC;c++){ const z=G.ZID[c]; if(z===255||G.SOL[c]===1) continue;
    const v=toM(Math.hypot(UX[c],UY[c])); zs[z].s+=v; zs[z].n++;
    if(!G.INM[c]) continue;
    n++; s+=v; bins[v<0.15?0:v<0.5?1:v<1?2:v<1.5?3:4]++;
    for(const [di,dj] of NB4){const nb=c+dj*NX+di; if(G.INM[nb]||G.SOL[nb]===1||G.ZID[nb]===z) continue; const f=toM(-(UX[nb]*di+UY[nb]*dj)); if(f>0){zs[z].qin+=f*CS*HOPEN; qin+=f*CS*HOPEN;}}
  }
  const vol=zones.reduce((a,z)=>a+(z.lvl===level&&!z.outdoor?z.V:0),0);
  return {mean:n?s/n:0,bins:bins.map(b=>n?b/n:0),zs:zs.map(z=>z.n?z.s/z.n:NaN),ach:zs.map((z,i)=>zones[i].V?z.qin*3600/zones[i].V:0),qin,achAll:vol?qin*3600/vol:0,n,level};
}
/* ---- antrean hitung aliran stabil di latar belakang (Web Worker) ---- */
const AIRC=new Map(), AIRF=new Map(); const airJobs=[]; let airJob=null, airWorker=null, airJobId=0;
try{
  const src="const lbmSteps="+lbmSteps.toString()+";\nonmessage=function(e){const d=e.data;const NC=d.NX*d.NY;let A=d.F,B=new Float32Array(9*NC);const UX=new Float32Array(NC),UY=new Float32Array(NC);const r=lbmSteps(A,B,d.SOL,d.NX,d.NY,d.wu,d.wv,d.steps,UX,UY);postMessage({id:d.id,UX,UY,F:r[0]},[UX.buffer,UY.buffer,r[0].buffer]);};";
  airWorker=new Worker(URL.createObjectURL(new Blob([src],{type:"text/javascript"})));
  airWorker.onmessage=e=>airFinish(e.data.UX,e.data.UY,e.data.F);
  airWorker.onerror=()=>{airWorker=null; if(airJob){const j=airJob;airJob=null;airJobs.unshift(j);pumpAir();}};
}catch(e){airWorker=null;}
function wantAir(level,dir,S,front){
  const key=airKey(level,dir,S);
  if(AIRC.has(key)||(airJob&&airJob.key===key)) return;
  const k=airJobs.findIndex(j=>j.key===key); if(k>=0){ if(front){const [j]=airJobs.splice(k,1); airJobs.unshift(j);} return; }
  const job={key,level,dir,S:new Set(AIRSOL.filter(x=>S.has(x)))};
  front?airJobs.unshift(job):airJobs.push(job); pumpAir();
}
function pumpAir(){
  if(airJob||!airJobs.length) return;
  let job=airJobs.shift();
  const bk=job.level+"|"+job.dir+"|";
  if(job.key!==bk&&!AIRF.has(bk)){ airJobs.unshift(job); job={key:bk,level:job.level,dir:job.dir,S:new Set()}; const k=airJobs.findIndex(j=>j.key===bk); if(k>=0) airJobs.splice(k,1); }
  if(AIRC.has(job.key)){ pumpAir(); return; }
  airJob=job; job.G=airGrid(job.level,job.S);
  const d=job.dir*rad, wu=-Math.sin(d)*U0, wv=-Math.cos(d)*U0, isBase=job.key===bk;
  const F=isBase?new Float32Array(9*NC):AIRF.get(bk).slice(); if(isBase) lbmInit(F,job.G.SOL,wu,wv);
  const steps=isBase?2200:900;
  if(airWorker){ airWorker.postMessage({id:++airJobId,F,SOL:job.G.SOL,NX,NY,wu,wv,steps}); }
  else { // cadangan: dicicil di thread utama
    let A=F,B=new Float32Array(9*NC),left=steps; const UXb=new Float32Array(NC),UYb=new Float32Array(NC);
    (function slice(){ const n=Math.min(25,left); [A,B]=lbmSteps(A,B,job.G.SOL,NX,NY,wu,wv,n,UXb,UYb); left-=n; if(left>0) setTimeout(slice,0); else airFinish(UXb,UYb,A); })();
  }
}
function airFinish(UXr,UYr,F){
  const job=airJob; airJob=null; if(!job) return;
  AIRC.set(job.key,{UX:UXr,UY:UYr,G:job.G});
  if(job.key===job.level+"|"+job.dir+"|") AIRF.set(job.key,F);
  onAirReady(job); pumpAir();
}
function airResult(level,dir,S){const r=AIRC.get(airKey(level,dir,S)); return r?airStatsFrom(level,r.G,r.UX,r.UY):null;}
function requestAirAll(){
  // prioritas: tampilan sekarang, lalu dasar, lalu tiap solusi sendiri (untuk kartu dampak)
  const lv=A==="udara"?P.level:1;
  wantAir(lv,P.windDir,ON,true); wantAir(lv,P.windDir,new Set());
  AIRSOL.forEach(s=>wantAir(lv,P.windDir,new Set([s])));
  if(lv!==1){wantAir(1,P.windDir,ON); wantAir(1,P.windDir,new Set()); AIRSOL.forEach(s=>wantAir(1,P.windDir,new Set([s])));}
}
let airPanelT=0;
function onAirReady(){ clearTimeout(airPanelT); airPanelT=setTimeout(()=>{ if(A==="udara"||A==="model"||panelNeedsAir()) refreshPanel(); },60); }
const panelNeedsAir=()=>true;

/* ---- tampilan aliran langsung ---- */
let F=new Float32Array(9*NC), F2=new Float32Array(9*NC);
const UX=new Float32Array(NC), UY=new Float32Array(NC);
let liveKey="", G1=null, SOL=null, ZID=null, INM=null, airLevel=0, wu=0, wv=0, airSteps=0, ZB={x0:0,x1:NX,y0:0,y1:NY};
function airInit(level){
  airLevel=level; liveKey=airKey(level,P.windDir,ON); G1=airGrid(level,ON); SOL=G1.SOL; ZID=G1.ZID; INM=G1.INM; ZB=G1.bb;
  const d=P.windDir*rad; wu=-Math.sin(d)*U0; wv=-Math.cos(d)*U0;
  const warm=AIRC.get(airKey(level,P.windDir,ON));
  lbmInit(F,SOL,wu,wv);
  for(let c=0;c<NC;c++){UX[c]=SOL[c]===1?0:wu;UY[c]=SOL[c]===1?0:wv;}
  if(warm){ UX.set(warm.UX); UY.set(warm.UY); for(let c=0;c<NC;c++) if(SOL[c]!==1){const u=UX[c],v=UY[c],uu=1.5*(u*u+v*v);const EXk=[0,1,0,-1,0,1,-1,-1,1],EYk=[0,0,1,0,-1,1,1,-1,-1],WTk=[4/9,1/9,1/9,1/9,1/9,1/36,1/36,1/36,1/36];for(let k=0;k<9;k++){const e=3*(EXk[k]*u+EYk[k]*v);F[k*NC+c]=WTk[k]*(1+e+0.5*e*e-uu);}} airSteps=900; }
  else airSteps=0;
  liveStats=null; seedAll();
  airTex.needsUpdate=true; airPlane.position.y=levelGrids[level-1].y-0.05; trails.position.y=levelGrids[level-1].y;
}
function airStep(n){ [F,F2]=lbmSteps(F,F2,SOL,NX,NY,wu,wv,n,UX,UY); airSteps+=n; }
const airData=new Uint8Array(NC*4);
const airTex=new THREE.DataTexture(airData,NX,NY,THREE.RGBAFormat); airTex.magFilter=THREE.LinearFilter; airTex.minFilter=THREE.LinearFilter;
const airPlane=new THREE.Mesh(new THREE.PlaneGeometry(NX*CS,NY*CS).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:airTex,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
airPlane.position.set(AIR.ox+NX*CS/2,0,-(AIR.oy+NY*CS/2)); airPlane.renderOrder=3; scene.add(airPlane);
const VMAX=2.5;
const toMs=s=>s/U0*P.wind*HF[airLevel||1];
function paintAir(){
  for(let c=0;c<NC;c++){
    const o=c*4;
    if(SOL[c]===1){airData[o]=30;airData[o+1]=32;airData[o+2]=36;airData[o+3]=255;continue;}
    if(SOL[c]===2){airData[o]=150;airData[o+1]=158;airData[o+2]=162;airData[o+3]=235;continue;}
    const v=toMs(Math.hypot(UX[c],UY[c])), col=rampJS(v/VMAX);
    airData[o]=col[0]*255;airData[o+1]=col[1]*255;airData[o+2]=col[2]*255;airData[o+3]=INM[c]?235:70;
    if(INM[c]){
      let fin=0;
      for(const [di,dj] of NB4){const n=c+dj*NX+di; if(INM[n]||SOL[n]===1) continue; fin+=-(UX[n]*di+UY[n]*dj);}
      const f=toMs(fin);
      if(f>0.12){airData[o]=90;airData[o+1]=245;airData[o+2]=255;airData[o+3]=255;}
      else if(f<-0.12){airData[o]=255;airData[o+1]=120;airData[o+2]=200;airData[o+3]=255;}
    }
  }
  airTex.needsUpdate=true;
}
const NP=2400, TLN=12;
const ppos=new Float32Array(NP*TLN*2), page=new Float32Array(NP), plife=new Float32Array(NP);
const tpos=new Float32Array(NP*(TLN-1)*2*3), tcol=new Float32Array(NP*(TLN-1)*2*4);
const tgeo=new THREE.BufferGeometry(); tgeo.setAttribute("position",new THREE.BufferAttribute(tpos,3)); tgeo.setAttribute("color",new THREE.BufferAttribute(tcol,4));
const trails=new THREE.LineSegments(tgeo,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,depthWrite:false,depthTest:false}));
trails.renderOrder=6; trails.frustumCulled=false; scene.add(trails);
function seed(p){
  const cx=(ZB.x0+ZB.x1)/2, cy=(ZB.y0+ZB.y1)/2, R=Math.hypot(ZB.x1-ZB.x0,ZB.y1-ZB.y0)/2;
  const wn=Math.hypot(wu,wv)||1, ax=wu/wn, ay=wv/wn;
  let x,y; for(let k=0;k<30;k++){
    if(Math.random()<0.7){const off=(Math.random()*2-1)*R*0.95, back=R+4+Math.random()*10; x=cx-ax*back-ay*off; y=cy-ay*back+ax*off;}
    else {x=ZB.x0-6+Math.random()*(ZB.x1-ZB.x0+12); y=ZB.y0-6+Math.random()*(ZB.y1-ZB.y0+12);}
    x=Math.max(2,Math.min(NX-3,x)); y=Math.max(2,Math.min(NY-3,y));
    const c=(y|0)*NX+(x|0); if(SOL[c]!==1) break;
  }
  for(let k=0;k<TLN;k++){ppos[(p*TLN+k)*2]=x;ppos[(p*TLN+k)*2+1]=y;}
  page[p]=0; plife[p]=180+Math.random()*260;
}
function seedAll(){for(let p=0;p<NP;p++){seed(p);page[p]=Math.random()*plife[p]*0.6;}}
function sampleU(x,y){
  const i=Math.max(0,Math.min(NX-2,x-0.5|0)), j=Math.max(0,Math.min(NY-2,y-0.5|0)), fx=Math.min(1,Math.max(0,x-0.5-i)), fy=Math.min(1,Math.max(0,y-0.5-j)), c=j*NX+i;
  const u=UX[c]*(1-fx)*(1-fy)+UX[c+1]*fx*(1-fy)+UX[c+NX]*(1-fx)*fy+UX[c+NX+1]*fx*fy;
  const v=UY[c]*(1-fx)*(1-fy)+UY[c+1]*fx*(1-fy)+UY[c+NX]*(1-fx)*fy+UY[c+NX+1]*fx*fy;
  return [u,v];
}
const pin=new Float32Array(NP);
function stepParticles(dt){
  const adv=dt*60*0.5;
  for(let p=0;p<NP;p++){
    const b=p*TLN*2;
    for(let k=TLN-1;k>0;k--){ppos[b+k*2]=ppos[b+(k-1)*2];ppos[b+k*2+1]=ppos[b+(k-1)*2+1];}
    const [u,v]=sampleU(ppos[b],ppos[b+1]);
    ppos[b]+=u/U0*adv; ppos[b+1]+=v/U0*adv; page[p]+=1;
    const x=ppos[b],y=ppos[b+1],c=(y|0)*NX+(x|0);
    const inside=INM[c]===1; pin[p]=pin[p]*0.85+(inside?0.15:0);
    if(page[p]>plife[p]||x<1||y<1||x>NX-2||y>NY-2||SOL[c]===1||(x<ZB.x0-30||x>ZB.x1+30||y<ZB.y0-30||y>ZB.y1+30)) {seed(p);pin[p]=0;}
  }
  let o=0,oc=0;
  for(let p=0;p<NP;p++){
    const b=p*TLN*2, fade=Math.min(1,page[p]/8)*Math.min(1,(plife[p]-page[p])/15);
    const [u,v]=sampleU(ppos[b],ppos[b+1]); const sp=Math.min(1,toMs(Math.hypot(u,v))/VMAX), col=rampJS(0.3+sp*0.7), k1=pin[p];
    const r=1*(1-k1)+col[0]*k1, g=1*(1-k1)+col[1]*k1, bl=1*(1-k1)+col[2]*k1, am=0.32+0.68*k1;
    for(let k=0;k<TLN-1;k++){
      for(let e=0;e<2;e++){
        const q=b+(k+e)*2, X=AIR.ox+ppos[q]*CS, Y=AIR.oy+ppos[q+1]*CS;
        tpos[o++]=X;tpos[o++]=0;tpos[o++]=-Y;
        const a=(1-(k+e)/(TLN-1))*fade*am;
        tcol[oc++]=r;tcol[oc++]=g;tcol[oc++]=bl;tcol[oc++]=a;
      }
    }
  }
  tgeo.attributes.position.needsUpdate=true; tgeo.attributes.color.needsUpdate=true;
}
let liveStats=null;
/* statistik udara yang dipakai panel: hasil stabil bila sudah ada, kalau belum dari aliran langsung */
function curAir(){ const r=airResult(airLevel,P.windDir,ON); if(r) return Object.assign(r,{stable:true}); return liveStats?Object.assign(liveStats,{stable:false}):null; }

/* ================= warna ================= */
function rampJS(x){x=Math.max(0,Math.min(1,x));const S=[[0,[.09,.10,.30]],[.2,[.13,.42,.62]],[.45,[.30,.74,.62]],[.7,[.98,.84,.30]],[.88,[.93,.36,.16]],[1,[.62,.07,.10]]];
  for(let i=1;i<S.length;i++)if(x<=S[i][0]){const f=(x-S[i-1][0])/(S[i][0]-S[i-1][0]);return S[i-1][1].map((a,k)=>a+(S[i][1][k]-a)*f)}return S[5][1]}
function divJS(x){x=Math.max(0,Math.min(1,x));const a=[.16,.38,.72],m=[.93,.93,.90],b=[.80,.18,.15];
  return x<.5?a.map((v,k)=>v+(m[k]-v)*x*2):m.map((v,k)=>v+(b[k]-v)*(x-.5)*2)}
const LUXSTOPS=[[0,[.10,.10,.22]],[100,[.24,.30,.62]],[300,[.30,.72,.66]],[750,[.96,.86,.42]],[3000,[.98,.60,.22]],[20000,[.96,.96,.92]]];
function luxCol(E){
  const l=Math.log10(Math.max(1,E)), S=LUXSTOPS.map(s=>[Math.log10(Math.max(1,s[0])),s[1]]);
  if(l<=S[0][0])return S[0][1];
  for(let i=1;i<S.length;i++) if(l<=S[i][0]){const f=(l-S[i-1][0])/(S[i][0]-S[i-1][0]);return S[i-1][1].map((a,k)=>a+(S[i][1][k]-a)*f)}
  return S[S.length-1][1];
}
const css=c=>"rgb("+c.map(x=>Math.round(x*255)).join(",")+")";
const TRANGE=[26,38], LMAX=200;

/* ================= evaluasi: hasil, target, dampak solusi ================= */
let RES={base:null,cur:null}, IMP={}, LUX=null, SIMS={}, NOISE=null;
function evalSet(S){
  const lux=computeDaylight(S);
  return {S:new Set(S),lux,ac:simulate(true,S,lux),nv:simulate(false,S,lux),nz:computeNoise(S)};
}
function metrics(e,air1){
  const ac=e.ac, nv=e.nv;
  const ackwh=ac.totQ.reduce((a,b)=>a+b,0)*600/3.6e6, acEl=ackwh/(P.cop*(e.S.has("inverter")?INV_K:1)), lamp=e.lux.lamp, fan=e.S.has("fans")?FAN_W*condArea*12/1000:0;
  const m={acEl,lamp,fan,elecTot:acEl+lamp+fan,peak:Math.max(...ac.totQ)/1000,
    maxT:Math.max(...nv.maxT), sda:e.lux.sda*100, ase:e.lux.ase*100,
    fac:e.nz.facDay, ins:e.nz.insDay, train:e.nz.lmaxIn};
  if(air1){
    m.stag=air1.bins[0]*100; m.ach=air1.achAll;
    const c=coolParts(e.S,air1); m.vWind=air1.mean; m.coolOpen=c.open; m.coolOff=c.off;
    let hot=0; indoor.forEach(z=>{const T=nv.res[zones.indexOf(z)].T; let h=0; for(let j=60;j<132;j++) if(T[j]-coolAt(e.S,c,j/6)>COMFORT) h+=1/6; hot+=h*z.A;});
    m.hot=hot/condArea;
  }
  return m;
}
/* target: k metrik, op arah lulus, v ambang */
const TARGETS={
  energi:[{id:"cut",k:"cut",op:">=",v:30,u:"%",d:0}],
  suhu:[{id:"hot",k:"hot",op:"<=",v:3,u:"h",d:1}],
  cahaya:[{id:"sda",k:"sda",op:">=",v:55,u:"%",d:0},{id:"ase",k:"ase",op:"<=",v:10,u:"%",d:0}],
  udara:[{id:"stag",k:"stag",op:"<=",v:30,u:"%",d:0},{id:"ach",k:"ach",op:">=",v:5,u:"ACH",d:0}],
  suara:[{id:"fac",k:"fac",op:"<=",v:70,u:"dB(A)",d:0},{id:"ins",k:"ins",op:"<=",v:50,u:"dB(A)",d:0},{id:"train",k:"train",op:"<=",v:55,u:"dB(A)",d:0}]
};
const DOMS=["energi","suhu","cahaya","udara","suara"];
/* efek sejuk dari kecepatan udara: angin alami (hasil aliran Lt 1) dan kipas saat jam buka */
function coolParts(S,air){const vw=air?air.mean:0, vf=S.has("fans")?FAN_V:0;return {open:coolEff(Math.hypot(vw,vf)),off:coolEff(vw),fan:coolEff(vf)};}
const mixAt=(S,h)=>S.has("mixed")&&h>=MIX_H[0]&&h<MIX_H[1];
function coolAt(S,c,h){return mixAt(S,h)?c.fan:(isOpen(h)?c.open:c.off);}
function feelArr(e,air){const c=coolParts(e.S,air), o=new Float64Array(144); for(let j=0;j<144;j++) o[j]=e.nv.meanT[j]-coolAt(e.S,c,j/6); return o;}
const passes=(tg,v)=>{if(v===undefined||isNaN(v))return null; const f=Math.pow(10,tg.d), r=Math.round(v*f)/f; return tg.op===">="?r>=tg.v:r<=tg.v;};
const REL={elecTot:1,acEl:1,lamp:1};
const sig=(k,dv,b)=>REL[k]?Math.abs(b?dv/b*100:0)>=0.5:Math.abs(dv)>SIGN[k];
/* metrik lengkap untuk satu set solusi (udara pada lantai lv) */
function fullMetrics(e,S,lv){
  const air=airResult(lv,P.windDir,S);
  const m=metrics(e,air);
  m.cut=RES.base?(1-m.elecTot/RES.baseM.elecTot)*100:0;
  return m;
}
const BETTER={elecTot:-1,acEl:-1,lamp:-1,peak:-1,cut:1,hot:-1,maxT:-1,sda:1,ase:-1,stag:-1,ach:1,fac:-1,ins:-1,train:-1};
const SIGN={elecTot:1,acEl:1,lamp:1,peak:0.5,cut:1,hot:0.2,maxT:0.2,sda:1,ase:1,stag:2,ach:1,fac:0.4,ins:0.4,train:0.4};
function recomputeAll(){
  W=weather(P.month);
  RES.base=evalSet(new Set()); RES.cur=ON.size?evalSet(ON):RES.base;
  RES.baseM=metrics(RES.base);
  LUX=RES.cur.lux; SIMS={ac:RES.cur.ac,nv:RES.cur.nv}; NOISE=RES.cur.nz;
  scheduleImpacts();
}
function recomputeCur(){
  RES.cur=ON.size?evalSet(ON):RES.base;
  LUX=RES.cur.lux; SIMS={ac:RES.cur.ac,nv:RES.cur.nv}; NOISE=RES.cur.nz;
}
let impQ=[], impT=null, impVer=0;
function scheduleImpacts(){
  impVer++; const ver=impVer; IMP={}; clearTimeout(impT);
  impT=setTimeout(()=>{ if(ver!==impVer) return; SOLN.forEach(s=>IMP[s.id]=evalSet(new Set([s.id]))); refreshPanel(); },30);
}
/* dampak satu solusi sendiri dibanding desain dasar */
function impactOf(id,lv){
  const e=IMP[id]; if(!e||!RES.base) return null;
  const m=fullMetrics(e,new Set([id]),lv), b=fullMetrics(RES.base,new Set(),lv);
  const d={}; for(const k in BETTER){ if(m[k]===undefined||b[k]===undefined) continue; d[k]=m[k]-b[k]; }
  return {m,b,d};
}
function domainStatus(dom,m){
  const r=TARGETS[dom].map(tg=>passes(tg,m[tg.k]));
  if(r.some(x=>x===null)) return null;
  return r.every(Boolean);
}
/* rekomendasi: membantu target yang belum lulus, tanpa memperburuk target lain secara berarti */
function solVerdict(id,dom,lv){
  const im=impactOf(id,lv); if(!im) return null;
  const helps=[], hurts=[];
  for(const D of DOMS) for(const tg of TARGETS[D]){
    const k=tg.k, dv=im.d[k]; if(dv===undefined||isNaN(dv)||!sig(k,dv,im.b[k])) continue;
    const good=dv*BETTER[k]>0;
    if(good&&!passes(tg,im.b[k])) helps.push({D,tg,dv});
    if(!good&&!passes(tg,im.m[k])) hurts.push({D,tg,dv});
  }
  const helpsHere=helps.some(h=>h.D===dom);
  const hurtsHere=hurts.some(h=>h.D===dom);
  return {im,helps,hurts,helpsHere,kind:helpsHere?(hurts.length?"trade":"rec"):hurtsHere?"worse":(helps.length?"other":"none")};
}

/* ================= keadaan tampilan ================= */
let A="model", ev="rad", hour=7, playing=true, speed=1, selZone=-1;
const SUBS={energi:["rad","load"],suhu:[],model:[],suara:["0","1","2","3"],cahaya:["0","1","2","3"],udara:["1","2","3"]};
let luxLevel=0, nzLevel=0;
function ghost(on){
  bmats.forEach(m=>{
    if(on){m.transparent=true;m.opacity=m.userData.ground?1:0.12;m.depthWrite=!!m.userData.ground;}
    else {m.transparent=!!m.userData.trans;m.opacity=m.userData.baseOpacity;m.depthWrite=!m.userData.trans;}
    m.needsUpdate=true;
  });
}
const FLOORY={1:0,2:3.7,3:6.7};
function applyScene(){
  const rad3=A==="energi"&&ev==="rad";
  U.uHeat.value=rad3?1:0;
  let cut=null, gh=false;
  if(A==="udara") cut=FLOORY[P.level]+1.6;
  else if(A==="cahaya") {if(luxLevel) cut=FLOORY[luxLevel]+1.6; else gh=true;}
  else if(A==="suara") {if(nzLevel) cut=FLOORY[nzLevel]+1.6; else gh=true;}
  else if(A==="suhu"||(A==="energi"&&ev==="load")) gh=true;
  ghost(gh); clipPlane.constant=cut===null?1000:cut;
  zoneGroup.visible=(A==="energi"&&ev==="load")||A==="suhu";
  luxGroup.visible=A==="cahaya";
  for(const L of [1,2,3]) luxMeshes[L].visible=luxLevel===0||luxLevel===L;
  noiseGroup.visible=A==="suara";
  for(const L of [1,2,3]) nzMeshes[L].visible=nzLevel===0||nzLevel===L;
  airPlane.visible=trails.visible=A==="udara";
  $("audioDock").hidden=A!=="suara";
}
function setAnalysis(a){
  A=a; selZone=-1;
  [...$("tabs").children].forEach(b=>b.setAttribute("aria-pressed",b.dataset.a===a));
  if(a==="udara"&&liveKey!==airKey(P.level,P.windDir,ON)) airInit(P.level);
  requestAirAll();
  renderAll();
  try{history.replaceState(null,"","#"+a);}catch(e){}
}
function renderAll(){
  renderStatic(); renderHead(); renderSubs(); renderCtrls(); applyScene(); renderNotes(); renderZoneList(); refreshPanel(); updateLegend(); updateFrame();
}
function renderSubs(){
  const box=$("subs"), list=SUBS[A];
  box.hidden=!list.length;
  const cur=A==="energi"?ev:A==="cahaya"?String(luxLevel):A==="suara"?String(nzLevel):String(P.level);
  box.innerHTML=list.map(k=>'<button data-k="'+k+'" aria-pressed="'+(k===cur)+'">'+t("sub."+(A==="energi"?k:(k==="0"?"all":"lvl")),{n:k})+'</button>').join("");
  [...box.children].forEach(b=>b.onclick=()=>{
    const k=b.dataset.k;
    if(A==="energi") ev=k; else if(A==="cahaya") luxLevel=+k; else if(A==="suara") nzLevel=+k; else {P.level=+k; airInit(P.level); requestAirAll();}
    renderSubs(); applyScene(); updateLegend(); refreshPanel(); updateFrame();
  });
}

/* ---- teks statis & bahasa ---- */
function renderStatic(){
  document.documentElement.lang=LANG;
  document.title=t("app.title");
  document.querySelectorAll("[data-i18n]").forEach(el=>{el.innerHTML=t(el.dataset.i18n);});
  document.querySelectorAll("[data-i18n-aria]").forEach(el=>{el.setAttribute("aria-label",t(el.dataset.i18nAria));});
  [...$("tabs").children].forEach(b=>{b.querySelector("span").textContent=t("tab."+b.dataset.a);});
  [...$("lang").children].forEach(b=>b.setAttribute("aria-pressed",b.dataset.l===LANG));
  const ms=$("month"), months=t("months"); ms.innerHTML=months.map((m,i)=>'<option value="'+i+'">'+m+'</option>').join(""); ms.value=P.month;
  const sp=$("spd"); [...sp.options].forEach(o=>o.textContent=t("speed",{n:nf(+o.value,o.value==="0.5"?1:0)}));
  $("ticks").innerHTML=[0,6,12,18,24].map(h=>'<span>'+String(h).padStart(2,"0")+'</span>').join("");
  $("trainBtn").textContent=t("aud.train");
  updateAudioBtn();
}
function setLang(l){
  if(!I[l]||l===LANG) return; LANG=l; try{localStorage.setItem("fh-lang",l);}catch(e){}
  renderAll(); renderIntro();
}

/* ---- kepala panel ---- */
function renderHead(){
  $("aStep").innerHTML=A==="model"?t("head.overview"):t("dom."+A);
  $("aTitle").textContent=A==="model"?t("ov.title"):t("q."+A);
  $("aSub").innerHTML=A==="model"?t("ov.goal"):t("why."+A);
}

/* ---- kondisi uji ---- */
function rng(id,lab,min,max,step,val,fmt){return '<label>'+lab+' <span class="v" id="'+id+'V">'+fmt(val)+'</span><input type="range" id="'+id+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'"></label>';}
function condSummary(){
  const mo=t("months")[P.month];
  if(A==="energi") return mo+" · "+t("c.sp")+" "+nf(P.sp,1)+" °C";
  if(A==="suhu") return mo+" · "+t("dirs")[P.windDir/45]+" "+nf(P.wind,1)+" m/s";
  if(A==="cahaya") return mo+" · "+P.lux+" lux";
  if(A==="udara") return t("dirs")[P.windDir/45]+" · "+nf(P.wind,1)+" m/s · "+t("sub.lvl",{n:P.level});
  if(A==="suara") return t("c.traffic")+" "+Math.round(P.traffic*100)+"%";
  return mo;
}
function renderCtrls(){
  const sec=$("secCtrl"); sec.hidden=A==="model";
  if(A==="model"){ $("ctrls").innerHTML=""; return; }
  $("condSum").textContent=condSummary();
  let h="";
  if(A==="energi") h+=rng("c-sp",t("c.sp"),22,28,.5,P.sp,v=>nf(v,1)+" °C")+rng("c-occ",t("c.occ"),0,150,10,P.occ*100,v=>v+"%")+rng("c-cop",t("c.cop"),2,5,.1,P.cop,v=>nf(v,1));
  if(A==="suhu") h+='<label>'+t("c.dir")+'<select id="c-dir">'+t("dirs").map((a,i)=>'<option value="'+i*45+'">'+a+'</option>').join("")+'</select></label>'+rng("c-wind",t("c.wind"),0.5,5,0.5,P.wind,v=>nf(v,1)+" m/s")+rng("c-occ",t("c.occ"),0,150,10,P.occ*100,v=>v+"%");
  if(A==="cahaya") h+='<label>'+t("c.lux")+'<select id="c-lux"><option value="200">200 lux</option><option value="300">300 lux</option><option value="500">500 lux</option></select></label>';
  if(A==="udara") h+='<label>'+t("c.dir")+'<select id="c-dir">'+t("dirs").map((a,i)=>'<option value="'+i*45+'">'+a+'</option>').join("")+'</select></label>'+rng("c-wind",t("c.wind10"),0.5,5,0.5,P.wind,v=>nf(v,1)+" m/s");
  if(A==="suara"){
    h+=rng("c-trf",t("c.traffic"),50,150,10,P.traffic*100,v=>v+"%");
    h+='<label>'+t("c.listen")+'<select id="c-lis"><option value="kamera">'+t("c.lisCam")+'</option><option value="zona">'+t("c.lisZone")+'</option></select></label>';
    h+=rng("c-vol",t("c.vol"),0,100,5,P.vol*100,v=>v+"%");
  }
  $("ctrls").innerHTML=h;
  const bind=(id,fn,fmt)=>{const e=$(id); if(!e) return; e.oninput=()=>{fn(+e.value); $(id+"V").textContent=fmt(+e.value); $("condSum").textContent=condSummary();};};
  bind("c-trf",v=>{P.traffic=v/100;renoise();},v=>v+"%");
  bind("c-vol",v=>{P.vol=v/100;},v=>v+"%");
  if($("c-lis")){$("c-lis").value=P.listen;$("c-lis").onchange=e=>{P.listen=e.target.value;if(P.listen==="zona"&&selZone<0){const z=zones.find(z=>!z.outdoor&&z.lvl===1);selectZone(zones.indexOf(z));}};}
  bind("c-sp",v=>{P.sp=v;resim();},v=>nf(v,1)+" °C");
  bind("c-occ",v=>{P.occ=v/100;resim();},v=>v+"%");
  bind("c-cop",v=>{P.cop=v;refreshPanel();},v=>nf(v,1));
  bind("c-wind",v=>{P.wind=v;resim();},v=>nf(v,1)+" m/s");
  if($("c-lux")){$("c-lux").value=P.lux;$("c-lux").onchange=e=>{P.lux=+e.target.value;$("condSum").textContent=condSummary();resim();updateLegend();};}
  if($("c-dir")){$("c-dir").value=P.windDir;$("c-dir").onchange=e=>{P.windDir=+e.target.value;$("condSum").textContent=condSummary();if(A==="udara")airInit(P.level);requestAirAll();refreshPanel();};}
}
let simT=null; function resim(){clearTimeout(simT);simT=setTimeout(()=>{recomputeAll();refreshPanel();updateFrame();},140);}
let nzT=null; function renoise(){clearTimeout(nzT);nzT=setTimeout(()=>{recomputeAll();refreshPanel();updateFrame();},140);}

/* ---- solusi desain: aktifkan / matikan ---- */
function toggleSol(id,on){
  if(on===undefined) on=!ON.has(id);
  on?ON.add(id):ON.delete(id);
  afterSolChange();
}
function afterSolChange(){
  applySolutions3D(); recomputeCur();
  if(A==="udara"&&liveKey!==airKey(P.level,P.windDir,ON)) airInit(P.level);
  requestAirAll();
  refreshPanel(); updateFrame();
  try{localStorage.setItem("fh-sol",[...ON].join(","));}catch(e){}
}
function recommendedFor(dom){
  const lv=dom==="udara"?P.level:1;
  return SOLN.filter(s=>(dom==="model"||s.d.includes(dom))).filter(s=>{const v=solVerdict(s.id,dom==="model"?null:dom,lv); if(!v) return false; return dom==="model"?(v.helps.length&&!v.hurts.length):v.kind==="rec";}).map(s=>s.id);
}
const ICO={
  roof:'<path d="M3 11 12 4l9 7M5 10v9h14v-9" /><path d="M8 14h8"/>',
  fins:'<path d="M5 4v16M9 4v16M13 4v16M17 4v16M3 20h18"/>',
  tree:'<circle cx="12" cy="9" r="5"/><path d="M12 14v7M9 21h6"/>',
  bulb:'<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  fan:'<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4c0-4 1-6.4 3-6.4s2 3-3 6.4zM13.6 12c4 0 6.4 1 6.4 3s-3 2-6.4-3zM12 13.6c0 4-1 6.4-3 6.4s-2-3 3-6.4zM10.4 12c-4 0-6.4-1-6.4-3s3-2 6.4 3z"/>',
  wind:'<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  glass:'<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M8 8l-2 2M17 12l-3 3"/>',
  wall:'<path d="M3 20V9h18v11M3 14h18M8 9v5M14 9v5M11 14v6M17 14v6"/>',
  road:'<path d="M8 3 5 21M16 3l3 18M12 4v3M12 10v3M12 16v3"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  snow:'<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>'
};
const svgI=k=>'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICO[k]+'</svg>';
const CARDM={energi:["elecTot","peak"],suhu:["hot","maxT"],cahaya:["ase","sda","lamp"],udara:["stag","ach"],suara:["ins","train","fac"]};
const CHIPM={energi:["elecTot"],suhu:["hot"],cahaya:["sda","ase"],udara:["stag"],suara:["fac","ins","train"]};
function fmtDelta(k,dv,base){
  if(k==="elecTot"||k==="acEl"||k==="lamp") return sgn(base?dv/base*100:0,0)+"%";
  const d={peak:0,hot:1,maxT:1,sda:0,ase:0,stag:0,ach:0,fac:1,ins:1,train:1}[k];
  return sgn(dv,d)+" "+t("unit."+k);
}
function renderSolutions(){
  const box=$("sols"); const dom=A;
  const list=dom==="model"?SOLN:SOLN.filter(s=>s.d.includes(dom));
  const lv=dom==="udara"?P.level:1;
  const ready=Object.keys(IMP).length;
  $("solHint").innerHTML=dom==="model"?t("sol.hintAll"):t("sol.hint");
  box.innerHTML=list.map(s=>{
    const on=ON.has(s.id), v=solVerdict(s.id,dom==="model"?null:dom,lv);
    let main="", chips="", badge="";
    if(v){
      if(dom!=="model"){
        const shown=CARDM[dom].filter(k=>v.im.d[k]!==undefined&&sig(k,v.im.d[k],v.im.b[k])).slice(0,2);
        main=shown.map(k=>{const good=v.im.d[k]*BETTER[k]>0;return '<span class="imp '+(good?'good':'bad')+'"><b>'+fmtDelta(k,v.im.d[k],v.im.b[k])+'</b> '+t("m."+k)+'</span>';}).join("");
        if(!main) main='<span class="imp none">'+t("sol.noEffect")+'</span>';
      }
      const others=DOMS.filter(D=>D!==dom).map(D=>CHIPM[D].map(k=>{const dv=v.im.d[k]; if(dv===undefined||isNaN(dv)||!sig(k,dv,v.im.b[k])) return ""; const good=dv*BETTER[k]>0;
        const hurt=!good&&v.hurts.some(h=>h.tg.k===k||(k==="elecTot"&&h.tg.k==="cut"));
        return '<span class="chip '+(good?'good':hurt?'bad':'neutral')+'" title="'+t("dom."+D)+'">'+t("m."+k)+' '+fmtDelta(k,dv,v.im.b[k])+'</span>';}).join("")).join("");
      chips=others;
      badge=v.kind==="rec"?'<span class="badge rec">'+t("sol.rec")+'</span>':v.kind==="trade"?'<span class="badge trade">'+t("sol.trade")+'</span>':v.kind==="worse"?'<span class="badge worse">'+t("sol.worse")+'</span>':"";
      if(dom==="model") badge=(v.helps.length&&!v.hurts.length)?'<span class="badge rec">'+t("sol.rec")+'</span>':v.hurts.length?'<span class="badge trade">'+t("sol.trade")+'</span>':"";
    } else main='<span class="imp none">'+t("sol.calc")+'</span>';
    return '<div class="sol'+(on?' on':'')+'" data-id="'+s.id+'">'+
      '<button class="sw" role="switch" aria-checked="'+on+'" aria-label="'+t("sol."+s.id+".t")+'"><i></i></button>'+
      '<div class="sbody"><div class="stop"><span class="sico">'+svgI(s.ico)+'</span><b>'+t("sol."+s.id+".t")+'</b>'+badge+'</div>'+
      '<div class="sdesc">'+t("sol."+s.id+".d",{n:nf(FAN_C,1)})+'</div>'+
      (main?'<div class="simp">'+main+'</div>':'')+(chips?'<div class="chips">'+chips+'</div>':'')+'</div></div>';
  }).join("");
  box.querySelectorAll(".sol").forEach(el=>{
    const id=el.dataset.id;
    el.querySelector(".sw").onclick=e=>{e.stopPropagation();toggleSol(id);};
    el.onclick=()=>toggleSol(id);
    el.onmouseenter=()=>highlightSol(id,true); el.onmouseleave=()=>highlightSol(id,false);
  });
  const rec=recommendedFor(dom);
  const ab=$("solApply"); ab.disabled=!rec.length||rec.every(r=>ON.has(r)); ab.textContent=dom==="model"?t("sol.applyPkg"):t("sol.applyRec");
  ab.onclick=()=>{rec.forEach(r=>ON.add(r)); afterSolChange();};
  const rb=$("solReset"); rb.disabled=!ON.size; rb.onclick=()=>{ON.clear(); afterSolChange();};
  $("solCount").textContent=ON.size?t("sol.active",{n:ON.size}):"";
}

/* ---- penilaian: target vs hasil ---- */
function fmtVal(tg,v){return v===undefined||isNaN(v)?"…":nf(v,tg.d)+(tg.u==="%"?"%":" "+tg.u);}
function opTxt(tg){return (tg.op===">="?"≥ ":"≤ ")+nf(tg.v,0)+(tg.u==="%"?"%":" "+tg.u);}
function renderVerdict(){
  const box=$("verdict");
  if(A==="model"){ box.innerHTML=scorecard(); box.querySelectorAll("[data-go]").forEach(r=>r.onclick=()=>setAnalysis(r.dataset.go)); return; }
  const lv=A==="udara"?P.level:1;
  const mb=fullMetrics(RES.base,new Set(),lv), mc=fullMetrics(RES.cur,ON,lv);
  const rows=TARGETS[A].map(tg=>{
    const vb=mb[tg.k], vc=mc[tg.k], ok=passes(tg,vc);
    const chg=ON.size&&vb!==undefined&&vc!==undefined&&Math.abs(vc-vb)>=Math.pow(10,-tg.d)/2;
    return '<div class="trow '+(ok===null?'wait':ok?'ok':'no')+'"><span class="ti">'+(ok===null?'…':ok?'✓':'!')+'</span>'+
      '<div class="tl1"><b>'+t("tg."+tg.id)+'</b><small>'+t("tgs."+tg.id)+'</small></div>'+
      '<div class="tv">'+(chg?'<s>'+fmtVal(tg,vb)+'</s> ':'')+'<b>'+fmtVal(tg,vc)+'</b><small>'+t("target")+' '+opTxt(tg)+'</small></div></div>';
  }).join("");
  const st=TARGETS[A].map(tg=>passes(tg,mc[tg.k]));
  const nOk=st.filter(x=>x===true).length, wait=st.some(x=>x===null);
  const all=!wait&&nOk===st.length;
  const head=wait?'<span class="vchip wait">'+t("v.calc")+'</span>':all?'<span class="vchip ok">'+t("v.ok")+'</span>':'<span class="vchip no">'+t("v.no")+'</span>';
  const sub=wait?"":t("v.count",{a:nOk,b:st.length})+(ON.size?" · "+t("v.withSol",{n:ON.size}):" · "+t("v.baseDesign"));
  box.innerHTML='<div class="vhead">'+head+'<span class="vsub">'+sub+'</span></div>'+rows+(A==="udara"&&!airResult(lv,P.windDir,ON)?'<div class="vnote">'+t("v.airCalc")+'</div>':'');
}
function scorecard(){
  const mb1=fullMetrics(RES.base,new Set(),1), mc1=fullMetrics(RES.cur,ON,1);
  const head='<div class="sc-h"><span></span><span>'+t("sc.base")+'</span><span>'+(ON.size?t("sc.now",{n:ON.size}):t("sc.nowNone"))+'</span></div>';
  const rows=DOMS.map(D=>{
    const tg=TARGETS[D][0], stB=domainStatus(D,mb1), stC=domainStatus(D,mc1);
    const cell=(m,st)=>'<span class="sc-v '+(st===null?'wait':st?'ok':'no')+'"><i>'+(st===null?'…':st?'✓':'!')+'</i>'+fmtVal(tg,m[tg.k])+'</span>';
    return '<button class="sc-r" data-go="'+D+'"><span class="sc-d"><b>'+t("dom."+D)+'</b><small>'+t("tg."+tg.id)+' '+opTxt(tg)+'</small></span>'+cell(mb1,stB)+cell(mc1,stC)+'</button>';
  }).join("");
  const nb=DOMS.filter(D=>domainStatus(D,mb1)).length, nc=DOMS.filter(D=>domainStatus(D,mc1)).length;
  return '<div class="vhead"><span class="vchip '+(nc===5?'ok':'no')+'">'+t("sc.score",{n:nc})+'</span><span class="vsub">'+(ON.size?t("sc.from",{n:nb}):t("sc.hint"))+'</span></div>'+head+rows+'<div class="vnote">'+t("sc.note",{d:t("dirs")[P.windDir/45]})+'</div>';
}

/* ---- legenda ---- */
function gradient(stops){return 'linear-gradient(90deg,'+stops.join(",")+')'}
function updateLegend(){
  const L=$("legend"); let h="";
  if(A==="energi"&&ev==="rad") h='<b>'+t("lg.rad")+'</b><div class="bar" style="background:'+gradient([0,.2,.45,.7,.88,1].map(x=>css(rampJS(x))))+'"></div><div class="ticks"><span>0</span><span>500</span><span>1000 W/m²</span></div><div class="sub">'+t("lg.radSub")+'</div>';
  else if(A==="energi") h='<b>'+t("lg.load")+'</b><div class="bar" style="background:'+gradient([0,.2,.45,.7,.88,1].map(x=>css(rampJS(x))))+'"></div><div class="ticks"><span>0</span><span>100</span><span>200 W/m²</span></div><div class="sub">'+t("lg.loadSub")+'</div>';
  else if(A==="suhu") h='<b>'+t("lg.temp")+'</b><div class="bar" style="background:'+gradient([0,.25,.5,.75,1].map(x=>css(divJS(x))))+'"></div><div class="ticks"><span>26</span><span>32</span><span>38 °C</span></div>';
  else if(A==="cahaya"){const st=[10,30,100,300,1000,3000,10000,20000];h='<b>'+t("lg.lux")+'</b><div class="bar" style="background:'+gradient(st.map(e=>css(luxCol(e))))+'"></div><div class="ticks"><span>10</span><span>100</span><span>1k</span><span>20k lux</span></div><div class="sub">'+t("lg.luxSub",{n:P.lux})+'</div>';}
  else if(A==="suara"){const b=[35,40,45,50,55,60,65,70,75,80];h='<b>'+t("lg.noise")+'</b><div class="bar" style="background:'+gradient(b.map(x=>css(dbCol(x-1))))+'"></div><div class="ticks"><span>&lt;35</span><span>55</span><span>&gt;75 dB(A)</span></div><div class="sub">'+t("lg.noiseSub")+'</div>';}
  else if(A==="udara") h='<b>'+t("lg.air")+'</b><div class="bar" style="background:'+gradient([0,.2,.45,.7,.88,1].map(x=>css(rampJS(x))))+'"></div><div class="ticks"><span>0</span><span>'+nf(1.25,2)+'</span><span>'+nf(2.5,1)+' m/s</span></div><div class="sub">'+t("lg.airSub")+'</div>';
  else if(ON.size) h='<b>'+t("lg.sol")+'</b><div class="sub">'+[...ON].map(id=>t("sol."+id+".t")).join(" · ")+'</div>';
  L.innerHTML=h; L.hidden=!h;
}
function renderNotes(){
  $("notes").innerHTML=t("note."+A,{n:nf(FAN_C,1)})+t("note.common");
}

/* ---- KPI ---- */
function kpiHTML(list){return list.map(k=>'<div class="kpi"><div class="lbl">'+k[0]+'</div><div class="n">'+k[1]+'<small>'+k[2]+'</small></div><div class="d">'+k[3]+'</div></div>').join("")}
function refreshPanel(){
  if(!SIMS.ac) return;
  renderVerdict(); renderSolutions();
  const mo=t("months")[P.month];
  $("kpiLbl").textContent=t("kpi.head",{m:mo});
  $("secKpi").hidden=A==="model"; $("secChart").hidden=A==="model"; $("secStack").hidden=A==="model";
  if(A==="energi"){
    const m=metrics(RES.cur);
    $("kpis").innerHTML=kpiHTML([[t("k.elecTot"),nf(m.elecTot,0),"kWh/"+t("u.day"),t("k.elecTotD",{a:nf(m.acEl,0),l:nf(m.lamp,0)})],[t("k.peak"),nf(m.peak,1),"kW",nf(m.peak/3.517,1)+" TR · "+nf(m.peak*1000/condArea,0)+" W/m²"],[t("k.eui"),nf(m.acEl/condArea*365,0),"kWh/m²·"+t("u.yr"),t("k.euiD")],[t("k.area"),nf(condArea,0),"m²",t("k.areaD",{n:indoor.length})]]);
  } else if(A==="suhu"){
    const S=SIMS.nv, m=fullMetrics(RES.cur,ON,1), dmax=Math.max(...S.meanT)-Math.max(...S.To), air=airResult(1,P.windDir,ON);
    const fl=air?lerpArr(feelArr(RES.cur,air),hour):NaN;
    $("kpis").innerHTML=kpiHTML([[t("k.hot"),m.hot===undefined?"…":nf(m.hot,1),t("u.h"),t("k.hotD")],[t("k.maxT"),nf(m.maxT,1),"°C",t("k.maxTD")],[t("k.dT"),(dmax>=0?"+":"")+nf(dmax,1),"°C",t("k.dTD")],[t("k.feel"),isNaN(fl)?"…":nf(fl,1),"°C",air?t("k.feelD2",{w:nf(m.coolOff,1),f:ON.has("fans")?nf(m.coolOpen-m.coolOff,1):"0"}):t("k.calc")]]);
  } else if(A==="cahaya"){
    const save=LUX.kBase>0?(1-LUX.kDim/LUX.kBase)*100:0;
    $("kpis").innerHTML=kpiHTML([[t("k.sda",{n:P.lux}),nf(LUX.sda*100,0),"%",t("k.sdaD")],[t("k.ase"),nf(LUX.ase*100,0),"%",t("k.aseD")],[t("k.save"),nf(save,0),"%",t("k.saveD")],[t("k.lamp"),nf(LUX.lamp,0),"kWh/"+t("u.day"),ON.has("sensor")?t("k.lampOn"):t("k.lampOff",{n:nf(LUX.kDim,0)})]]);
  } else if(A==="suara"){
    const h=Math.floor(hour)%24, nb=NOISE;
    $("kpis").innerHTML=kpiHTML([[t("k.fac"),nf(nb.fac[h],0),"dB(A)",t("k.facD")],[t("k.ins"),nf(nb.ins[h],0),"dB(A)",t("k.insD")],[t("k.train"),nf(nb.lmaxIn,0),"dB(A)",t("k.trainD")],[t("k.over"),nf(nb.over[h]*100,0),"%",t("k.overD")]]);
    $("kpiLbl").textContent=t("kpi.headNow",{h:fmtH(hour)});
  } else if(A==="udara"){
    const s=curAir();
    if(!s){$("kpis").innerHTML=kpiHTML([[t("k.qin"),"…","m³/s",t("k.calc")],[t("k.mean"),"…","m/s",""],[t("k.stag"),"…","%",""],[t("k.cool"),"…","°C",""]]);}
    else{
      const Tz=lerpArr(SIMS.nv.meanT,hour);
      $("kpis").innerHTML=kpiHTML([[t("k.qin"),nf(s.qin,1),"m³/s",t("k.qinD",{n:nf(s.achAll,0)})],[t("k.mean"),nf(s.mean,2),"m/s",t("k.meanD",{l:airLevel,p:nf((s.bins[2]+s.bins[3]+s.bins[4])*100,0)})],[t("k.stag"),nf(s.bins[0]*100,0),"%",t("k.stagD")],[t("k.cool"),nf(coolEff(s.mean),1),"°C",t("k.coolD",{n:nf(Tz-coolEff(s.mean),1)})]]);
    }
    $("kpiLbl").textContent=t("kpi.headAir",{d:t("dirs")[P.windDir/45].toLowerCase()})+(s&&!s.stable?" · "+t("k.converging"):"");
  }
  drawChart(); updateStack(); updateZoneVals(); renderDetail(); updateLegend();
}
/* ---- grafik ---- */
function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()}
function drawChart(){
  if(!SIMS.ac||A==="model") return;
  const c=$("ch1"), dpr=window.devicePixelRatio||1, Wd=c.clientWidth, Ht=c.clientHeight; if(!Wd) return;
  c.width=Wd*dpr;c.height=Ht*dpr; const x=c.getContext("2d"); x.setTransform(dpr,0,0,dpr,0,0); x.clearRect(0,0,Wd,Ht);
  const ink=cssVar("--ink"),mut=cssVar("--muted"),line=cssVar("--line"),acc=cssVar("--accent"),warm=cssVar("--warm");
  const L=40,R=8,T=10,B=20, pw=Wd-L-R, ph=Ht-T-B;
  x.font="10.5px "+cssVar("--f-mono"); x.lineWidth=1;
  const cmp=ON.size>0;
  const leg=[];
  if(A==="suara"){
    $("chTitle").innerHTML=t("ch.noise");
    const X=h=>L+h/24*pw, ymin=30, ymax=80, Y=v=>T+ph-(Math.max(ymin,v)-ymin)/(ymax-ymin)*ph;
    x.fillStyle=mut;x.strokeStyle=line;
    [40,50,60,70,80].forEach(v=>{x.beginPath();x.moveTo(L,Y(v)+.5);x.lineTo(L+pw,Y(v)+.5);x.stroke();x.textAlign="right";x.fillText(v,L-5,Y(v)+3.5)});
    x.textAlign="left";x.fillText("dB",2,T+3);
    [0,6,12,18,24].forEach(h=>{x.textAlign=h===0?"left":h===24?"right":"center";x.fillText(String(h).padStart(2,"0"),X(h),Ht-5)});
    [[70,t("ch.limF")],[50,t("ch.limI")]].forEach(([v,l])=>{x.strokeStyle=warm;x.setLineDash([4,3]);x.beginPath();x.moveTo(L,Y(v));x.lineTo(L+pw,Y(v));x.stroke();x.setLineDash([]);x.fillStyle=warm;x.textAlign="right";x.fillText(l,L+pw,Y(v)-4);});
    const draw=(arr,col,w,fill,dash)=>{x.beginPath();for(let h=0;h<24;h++){const px=X(h+0.5),py=Y(arr[h]);h?x.lineTo(px,py):x.moveTo(px,py)}
      if(fill){x.lineTo(X(23.5),Y(ymin));x.lineTo(X(0.5),Y(ymin));x.closePath();x.fillStyle=col;x.globalAlpha=.18;x.fill();x.globalAlpha=1;} else {x.strokeStyle=col;x.lineWidth=w;if(dash)x.setLineDash([3,3]);x.stroke();x.setLineDash([]);x.lineWidth=1;}};
    if(cmp){draw(RES.base.nz.ins,mut,1.2,false,true);}
    draw(NOISE.ins,acc,0,true); draw(NOISE.ins,acc,2); draw(NOISE.fac,warm,1.5);
    x.strokeStyle=ink;x.beginPath();x.moveTo(X(hour)+.5,T);x.lineTo(X(hour)+.5,T+ph);x.stroke();
    const cv=NOISE.ins[Math.floor(hour)%24]; x.fillStyle=acc;x.beginPath();x.arc(X(hour),Y(cv),4,0,7);x.fill();
    leg.push([acc,t("ch.inside")],[warm,t("ch.facade")]); if(cmp) leg.push([mut,t("ch.base"),1]);
    $("nowLine").innerHTML='<span>'+t("ch.inside")+' <b>'+nf(cv,0)+' dB</b></span><span>'+t("ch.facade")+' <b>'+nf(NOISE.fac[Math.floor(hour)%24],0)+' dB</b></span>'+(train?'<span class="live"><i></i>'+t("ch.trainNow")+'</span>':'<span>'+nf(hourly(QH,hour)*P.traffic,0)+' '+t("ch.veh")+'</span>');
    $("chLeg").innerHTML=legHTML(leg); return;
  }
  if(A==="udara"){
    $("chTitle").textContent=t("ch.air");
    const labels=["<"+nf(0.15,2),nf(0.15,2)+"-"+nf(0.5,1),nf(0.5,1)+"-1","1-"+nf(1.5,1),">"+nf(1.5,1)], s=curAir(), sb=airResult(airLevel,P.windDir,new Set());
    const bw=pw/5;
    x.strokeStyle=line;[0,50,100].forEach(v=>{const y=T+ph-v/100*ph;x.beginPath();x.moveTo(L,y+.5);x.lineTo(L+pw,y+.5);x.stroke();x.fillStyle=mut;x.textAlign="right";x.fillText(v+"%",L-5,y+3.5)});
    labels.forEach((lb,i)=>{const v=s?s.bins[i]:0;const col=rampJS([0.05,0.18,0.35,0.55,0.75][i]);x.fillStyle=css(col);const h=v*ph;x.fillRect(L+i*bw+6,T+ph-h,bw-12,h);
      if(cmp&&sb){const hb=sb.bins[i]*ph;x.strokeStyle=ink;x.setLineDash([3,2]);x.strokeRect(L+i*bw+6.5,T+ph-hb+.5,bw-13,hb);x.setLineDash([]);}
      x.fillStyle=mut;x.textAlign="center";x.fillText(lb,L+i*bw+bw/2,Ht-5);if(s){x.fillStyle=ink;x.fillText(nf(v*100,0)+"%",L+i*bw+bw/2,T+ph-h-4)}});
    $("nowLine").innerHTML='<span>'+t("ch.airNote")+'</span><span>'+t("ch.steps")+' <b>'+airSteps+'</b></span>';
    if(cmp&&sb) leg.push([ink,t("ch.baseBox"),1]); $("chLeg").innerHTML=legHTML(leg);
    return;
  }
  const X=h=>L+h/24*pw;
  let ser,bser=null,ymax,ymin,unit,ticks,curArr,div=1;
  if(A==="energi"){ser=Array.from(SIMS.ac.totQ,v=>v/1000);if(cmp)bser=Array.from(RES.base.ac.totQ,v=>v/1000);ymin=0;ymax=Math.max(20,Math.ceil(Math.max(...ser,...(bser||[0]))/50)*50);unit="kW";ticks=[0,ymax/2,ymax];$("chTitle").textContent=t("ch.energy");curArr=SIMS.ac.totQ;div=1000;}
  else if(A==="suhu"){ser=Array.from(SIMS.nv.meanT);if(cmp)bser=Array.from(RES.base.nv.meanT);ymin=24;ymax=38;unit="°C";ticks=[24,28,32,36];$("chTitle").textContent=t("ch.temp");curArr=SIMS.nv.meanT;}
  else {ser=Array.from(LUX.frac,v=>v*100);if(cmp)bser=Array.from(RES.base.lux.frac,v=>v*100);ymin=0;ymax=100;unit="%";ticks=[0,50,100];$("chTitle").textContent=t("ch.lux",{n:P.lux});curArr=LUX.frac;div=0.01;}
  const Y=v=>T+ph-(v-ymin)/(ymax-ymin)*ph;
  x.fillStyle=mut;x.strokeStyle=line;
  ticks.forEach(v=>{x.beginPath();x.moveTo(L,Y(v)+.5);x.lineTo(L+pw,Y(v)+.5);x.stroke();x.textAlign="right";x.fillText(nf(v,0),L-5,Y(v)+3.5)});
  x.textAlign="left";x.fillText(unit,2,T+3);
  [0,6,12,18,24].forEach(h=>{x.textAlign=h===0?"left":h===24?"right":"center";x.fillText(String(h).padStart(2,"0"),X(h),Ht-5)});
  x.fillStyle=acc;x.globalAlpha=.07;x.fillRect(X(10),T,X(22)-X(10),ph);x.globalAlpha=1;
  const G=SIMS.ac.ghi;x.fillStyle=warm;x.globalAlpha=.14;x.beginPath();x.moveTo(X(0),T+ph);
  for(let j=0;j<144;j++)x.lineTo(X(j/6),T+ph-G[j]/1000*ph*.9);x.lineTo(X(24),T+ph);x.fill();x.globalAlpha=1;
  if(A!=="suhu"){x.beginPath();x.moveTo(X(0),Y(ymin));for(let j=0;j<144;j++)x.lineTo(X(j/6),Y(ser[j]));x.lineTo(X(24),Y(ymin));x.closePath();x.fillStyle=acc;x.globalAlpha=.2;x.fill();x.globalAlpha=1;}
  else{
    const S=SIMS.nv; x.strokeStyle=mut;x.setLineDash([2,2]);x.beginPath();for(let j=0;j<144;j++){j?x.lineTo(X(j/6),Y(S.To[j])):x.moveTo(X(0),Y(S.To[j]))}x.stroke();x.setLineDash([]);
    const air=airResult(1,P.windDir,ON); if(air){const fa=feelArr(RES.cur,air);x.strokeStyle=cssVar("--ok");x.lineWidth=1.6;x.setLineDash([5,3]);x.beginPath();for(let j=0;j<144;j++){j?x.lineTo(X(j/6),Y(fa[j])):x.moveTo(X(0),Y(fa[j]))}x.stroke();x.setLineDash([]);x.lineWidth=1;leg.push([cssVar("--ok"),t("ch.feel"),2]);}
    x.strokeStyle=warm;x.setLineDash([4,3]);x.beginPath();x.moveTo(L,Y(COMFORT));x.lineTo(L+pw,Y(COMFORT));x.stroke();x.setLineDash([]);x.fillStyle=warm;x.textAlign="right";x.fillText(t("ch.limT"),L+pw,Y(COMFORT)-4);
    leg.push([mut,t("ch.out"),1]);
  }
  if(bser){x.strokeStyle=mut;x.lineWidth=1.4;x.setLineDash([3,3]);x.beginPath();for(let j=0;j<144;j++){j?x.lineTo(X(j/6),Y(bser[j])):x.moveTo(X(0),Y(bser[j]))}x.stroke();x.setLineDash([]);x.lineWidth=1;leg.push([mut,t("ch.base"),1]);}
  x.strokeStyle=acc;x.lineWidth=2;x.beginPath();for(let j=0;j<144;j++){j?x.lineTo(X(j/6),Y(ser[j])):x.moveTo(X(0),Y(ser[j]))}x.stroke();
  leg.unshift([acc,cmp?t("ch.withSol"):t("ch.design")]);
  const cv=lerpArr(curArr,hour)/div;
  x.strokeStyle=ink;x.lineWidth=1;x.beginPath();x.moveTo(X(hour)+.5,T);x.lineTo(X(hour)+.5,T+ph);x.stroke();
  x.fillStyle=acc;x.beginPath();x.arc(X(hour),Y(cv),4,0,7);x.fill();x.strokeStyle=cssVar("--panel");x.lineWidth=2;x.stroke();
  const To=lerpArr(SIMS.ac.To,hour), ghi=lerpArr(SIMS.ac.ghi,hour);
  const main=A==="energi"?t("ch.nowLoad")+' <b>'+nf(cv,1)+' kW</b>':A==="suhu"?t("ch.inside")+' <b>'+nf(cv,1)+' °C</b>':t("ch.nowLux")+' <b>'+nf(cv,0)+'%</b>';
  $("nowLine").innerHTML='<span>'+main+'</span><span>'+t("ch.outT")+' <b>'+nf(To,1)+' °C</b></span><span>'+t("ch.sun")+' <b>'+nf(ghi,0)+' W/m²</b></span>';
  $("chLeg").innerHTML=legHTML(leg);
}
function legHTML(l){return l.map(([c,s,d])=>'<span><i style="background:'+c+(d?';height:2px;border-radius:0':'')+'"></i>'+s+'</span>').join("")+'<span><i class="band"></i>'+t("ch.open")+'</span>';}
/* ---- batang komposisi ---- */
function updateStack(){
  let items=[], foot="";
  if(A==="model") return;
  if(A==="energi"||A==="suhu"){
    const S=A==="energi"?SIMS.ac:SIMS.nv;
    $("stTitle").textContent=t("st.heat");
    items=COMP.filter(k=>A==="energi"||k!=="latent").map(k=>[t("comp."+k),lerpArr(S.comp[k],hour)/1000,COMPCOL[k],1]);
    foot=t("st.heatFoot");
  } else if(A==="suara"){
    $("stTitle").textContent=t("st.noise");
    const b=[0,0,0,0,0]; for(let i=0;i<NIN;i++) if(dIn[i]){const L=nzNow[i];b[L<45?0:L<55?1:L<65?2:L<70?3:4]++;}
    const lab=t("st.noiseBins"), ref=[42,52,62,67,72];
    items=lab.map((l,i)=>[l,b[i]/inPts*100,css(dbCol(ref[i])),0]);
    foot=t("st.noiseFoot");
  } else if(A==="cahaya"){
    $("stTitle").textContent=t("st.lux");
    const j=Math.min(143,Math.round(hour*6)), E=LUX.E, b=[0,0,0,0,0];
    for(let i=0;i<ND;i++) if(dIn[i]){const e=E[j*ND+i];b[e<100?0:e<P.lux?1:e<750?2:e<3000?3:4]++;}
    const lab=t("st.luxBins"), ref=[50,200,500,1500,8000];
    items=lab.map((l,i)=>[i===2?t("st.luxOk",{n:P.lux}):l,b[i]/inPts*100,css(luxCol(ref[i])),0]);
    foot=t("st.luxFoot");
  } else {
    $("stTitle").textContent=t("st.air");
    const s=curAir(), ref=[0.05,0.18,0.35,0.55,0.75]; items=t("st.airBins").map((l,i)=>[l,s?s.bins[i]*100:0,css(rampJS(ref[i])),0]);
    foot=t("st.airFoot",{n:airLevel});
  }
  const pos=items.filter(v=>v[1]>0), tot=pos.reduce((a,v)=>a+v[1],0)||1;
  $("stack").innerHTML=pos.map(v=>'<i style="width:'+(v[1]/tot*100)+'%;background:'+v[2]+'" title="'+v[0]+'"></i>').join("");
  $("keys").innerHTML=items.map(v=>'<div><i style="background:'+v[2]+'"></i>'+v[0]+'<span>'+(v[1]<0?"−":"")+nf(Math.abs(v[1]),v[3])+(v[3]?"":"%")+'</span></div>').join("")+'<div class="foot">'+foot+'</div>';
}
/* ---- daftar zona ---- */
function renderZoneList(){
  $("zl").innerHTML=zones.map((z,i)=>'<div class="zrow'+(i===selZone?' sel':'')+'" tabindex="0" data-i="'+i+'"><div class="nm"><b>'+zLabel(z)+'</b><small>'+zStorey(z)+(z.outdoor?' · '+t("z.out"):'')+'</small></div><div class="track"><i></i></div><div class="val"></div></div>').join("");
  $("zl").querySelectorAll(".zrow").forEach(r=>{const f=()=>selectZone(+r.dataset.i);r.onclick=f;r.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();f()}}});
  $("zlTitle").textContent=t("zl."+A);
}
function updateZoneVals(){
  const rows=$("zl").children; if(!SIMS.ac) return;
  let zl=null; const air=A==="udara"?curAir():null;
  if(A==="cahaya"){const j=Math.min(143,Math.round(hour*6));zl=zones.map(()=>[0,0]);for(let i=0;i<ND;i++){const z=zl[dZone[i]];z[0]+=LUX.E[j*ND+i];z[1]++;}}
  zones.forEach((z,i)=>{
    const row=rows[i]; if(!row) return;
    const bar=row.querySelector(".track i"), val=row.querySelector(".val");
    row.style.opacity=(A==="udara"&&z.lvl!==airLevel)?.4:1;
    if(A==="model"){ val.textContent=nf(z.A,0)+" m²"; bar.style.width=Math.min(100,z.A/280*100)+"%"; bar.style.background="var(--accent)"; return; }
    if(A==="suara"){
      let s2=0,n2=0; for(let k=0;k<NIN;k++) if(dZone[k]===i){s2+=Math.pow(10,nzNow[k]/10);n2++;}
      const L=n2?10*Math.log10(s2/n2):0; val.textContent=nf(L,0)+" dB(A)"; bar.style.width=Math.max(2,Math.min(100,(L-30)/50*100))+"%"; bar.style.background=css(dbCol(L)); return;
    }
    if(A==="energi"){
      const r=SIMS.ac.res[i];
      if(z.outdoor){val.innerHTML='<span class="tag">'+t("z.out")+'</span>';bar.style.width="0";return;}
      const q=lerpArr(r.Q,hour); val.textContent=nf(q/1000,1)+" kW";
      bar.style.width=Math.min(100,q/z.A/LMAX*100)+"%"; bar.style.background=css(rampJS(q/z.A/LMAX));
    } else if(A==="suhu"){
      const T=lerpArr(SIMS.nv.res[i].T,hour); val.textContent=nf(T,1)+" °C";
      bar.style.width=Math.max(2,(T-TRANGE[0])/(TRANGE[1]-TRANGE[0])*100)+"%"; bar.style.background=css(divJS((T-TRANGE[0])/(TRANGE[1]-TRANGE[0])));
    } else if(A==="cahaya"){
      const e=zl[i][1]?zl[i][0]/zl[i][1]:0; val.textContent=e>=10000?nf(e/1000,0)+"k lux":nf(e,0)+" lux";
      bar.style.width=Math.max(2,Math.min(100,Math.log10(Math.max(1,e))/4.3*100))+"%"; bar.style.background=css(luxCol(e));
    } else {
      const v=air?air.zs[i]:NaN;
      if(z.lvl!==airLevel||isNaN(v)){val.innerHTML='<span class="tag">'+t("sub.lvl",{n:z.lvl})+'</span>';bar.style.width="0";return;}
      if(z.outdoor){val.textContent=nf(v,2)+" m/s";} else val.textContent=nf(air.ach[i],0)+" ACH · "+nf(v,1)+" m/s";
      bar.style.width=Math.min(100,v/VMAX*100)+"%"; bar.style.background=css(rampJS(v/VMAX));
    }
  });
}
function renderDetail(){
  const d=$("detail");
  if(A==="model"&&selZone<0){const M=MODEL.meta;d.hidden=false;d.innerHTML='<h2>'+t("ifc.title")+'</h2><table class="meta">'+'<tr><td>'+t("ifc.schema")+'</td><td>'+M.schema+' · '+M.app+'</td></tr>'+M.storeys.map((s,i)=>'<tr><td>'+(i<3?t("storey",{n:i+1}):t("ifc.roof"))+'</td><td>+'+nf(s[1],2)+' m</td></tr>').join("")+M.counts.map((c,i)=>'<tr><td>'+t("ifc.c")[i]+'</td><td>'+c[1]+'</td></tr>').join("")+'</table>';return;}
  if(selZone<0||!SIMS.ac){d.hidden=true;return;}
  const z=zones[selZone]; d.hidden=false;
  const by={}; z.env.forEach(e=>{const k=e[0]==="open"?(e[1]<0?"skyOpen":"open"):e[0];by[k]=(by[k]||0)+e[2]});
  let rows='<tr><td>'+t("d.area")+'</td><td>'+nf(z.A,1)+' m² · '+nf(z.V,0)+' m³</td></tr>';
  const ra=SIMS.ac.res[selZone], rn=SIMS.nv.res[selZone];
  if(!z.outdoor){
    rows+='<tr><td>'+t("d.peak")+'</td><td>'+nf(ra.peak,1)+' kW</td></tr><tr><td>'+t("d.kwh")+'</td><td>'+nf(ra.kwh,0)+' kWh</td></tr>';
    rows+='<tr><td>'+t("d.maxT")+'</td><td>'+nf(rn.maxT,1)+' °C</td></tr><tr><td>'+t("d.hot")+'</td><td>'+nf(rn.hotOpen,1)+' '+t("u.h")+'</td></tr>';
  }
  const lz=LUX.zl[selZone]; if(lz&&lz.n) rows+='<tr><td>'+t("d.sda",{n:P.lux})+'</td><td>'+nf(lz.ok/lz.n*100,0)+'%</td></tr>';
  if(NOISE) rows+='<tr><td>'+t("d.noise")+'</td><td>'+nf(NOISE.zinsL[selZone],0)+' dB · '+nf(-NOISE.zins[selZone],0)+' dB</td></tr>';
  const air=curAir(); if(air&&z.lvl===airLevel&&!isNaN(air.zs[selZone])) rows+='<tr><td>'+t("d.wind",{n:airLevel})+'</td><td>'+nf(air.zs[selZone],2)+' m/s</td></tr>';
  d.innerHTML='<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h2>'+zLabel(z)+' · '+zStorey(z)+'</h2>'+(z.outdoor?'<span class="tag">'+t("z.outArea")+'</span>':'')+'</div><table>'+rows+
    '<tr><td colspan="2" class="lbl" style="padding-top:6px">'+t("d.env")+'</td></tr>'+Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'<tr><td>'+t("env."+k)+'</td><td>'+nf(v,1)+'</td></tr>').join("")+'</table>';
}
function selectZone(i){
  selZone=selZone===i?-1:i;
  [...$("zl").children].forEach((r,k)=>r.classList.toggle("sel",k===selZone));
  if(selZone>=0) $("secZones").open=true;
  renderDetail(); updateFrame();
}

/* ================= frame ================= */
const skyN=new THREE.Color(0x0c1420), skyD=new THREE.Color(0xe39a72), skyH=new THREE.Color(0x8fb9dc), tmpC=new THREE.Color();
function fmtH(h){const hh=Math.floor(h)%24,mm=Math.floor((h-Math.floor(h))*60);return String(hh).padStart(2,"0")+":"+String(mm).padStart(2,"0")}
function zoneColor(i){
  const z=zones[i];
  if(A==="suhu"){const T=lerpArr(SIMS.nv.res[i].T,hour);return divJS((T-TRANGE[0])/(TRANGE[1]-TRANGE[0]));}
  if(z.outdoor) return [.55,.57,.56];
  return rampJS(lerpArr(SIMS.ac.res[i].Q,hour)/z.A/LMAX);
}
let lastPanel=0;
function updateFrame(){
  if(!SIMS.ac) return;
  const s=sunAt(DOY[P.month],hour), w=W[Math.min(1439,Math.floor(hour*60))], sv=ifc2three(s);
  sunBall.position.copy(sv.clone().multiplyScalar(85)); sunBall.visible=s.alt>-0.03;
  sunL.position.copy(sv.clone().multiplyScalar(120)); sunL.intensity=s.alt>0?1:0;
  const day=Math.max(0,Math.min(1,s.alt/(25*rad))), dusk=Math.max(0,1-Math.abs(s.alt)/(12*rad));
  tmpC.copy(skyN).lerp(skyD,dusk*0.9).lerp(skyH,day); scene.background=tmpC.clone();
  hemi.intensity=0.12+0.45*day; amb.intensity=0.06+0.06*day;
  if(U.uHeat.value>0.5) sunL.color.setRGB(1,1,1); else sunL.color.setRGB(1,0.82+0.18*day,0.65+0.35*day);
  U.uDNI.value=w.dni;U.uDHI.value=w.dhi;U.uGHI.value=w.ghi;
  if(zoneGroup.visible) zmeshes.forEach((m,i)=>{const c=zoneColor(i);m.material.color.setRGB(c[0],c[1],c[2]);if(i===selZone) m.material.emissive.setHex(0x555555); else m.material.emissive.setRGB(c[0]*0.45,c[1]*0.45,c[2]*0.45);});
  if(luxGroup.visible){
    const j=hour*6, j0=Math.min(143,Math.floor(j)), j1=(j0+1)%144, f=j-j0, E=LUX.E;
    for(const L of [1,2,3]){ const ids=luxIdx[L], col=luxMeshes[L].geometry.attributes.color;
      ids.forEach((i,k)=>{const e=E[j0*ND+i]*(1-f)+E[j1*ND+i]*f;const c=luxCol(e);const hl=selZone>=0&&dZone[i]!==selZone?0.35:1;for(let q=0;q<4;q++)col.setXYZ(k*4+q,c[0]*hl,c[1]*hl,c[2]*hl);});
      col.needsUpdate=true; }
  }
  $("clk").textContent=fmtH(hour);
  $("sunInfo").textContent=s.alt>0?t("sun.up",{a:(s.alt/rad).toFixed(0),z:(s.az/rad).toFixed(0),g:w.ghi.toFixed(0)}):t("sun.down");
  if(noiseGroup.visible){
    noiseAt(hour,trainPresence(),nzNow,NOISE.adj);
    for(const L of [1,2,3]) paintTiles(nzMeshes[L],luxIdx[L],i=>{const c=dbCol(nzNow[i]);return selZone>=0&&dZone[i]!==selZone?c.map(v=>v*0.4):c;});
    paintTiles(siteTiles,siteIds,i=>dbCol(nzNow[NIN+i]));
  }
  $("hour").value=hour;
  const now=performance.now();
  if(now-lastPanel>120||!playing){lastPanel=now; drawChart(); updateStack(); updateZoneVals(); if(A==="udara") refreshKpiAirOnly(); if(A==="suhu"||A==="suara") refreshKpiNow();}
}
function refreshKpiAirOnly(){
  const s=curAir(); if(!s) return; const Tz=lerpArr(SIMS.nv.meanT,hour), el=$("kpis").children[3];
  if(el) el.querySelector(".d").textContent=t("k.coolD",{n:nf(Tz-coolEff(s.mean),1)});
}
let lastKpiH=-1;
function refreshKpiNow(){
  const h=A==="suara"?Math.floor(hour)%24:Math.round(hour*6); if(h===lastKpiH) return; lastKpiH=h;
  if(A==="suara"){ const nb=NOISE, k=$("kpis").children; if(k.length<4) return;
    k[0].querySelector(".n").firstChild.textContent=nf(nb.fac[h],0); k[1].querySelector(".n").firstChild.textContent=nf(nb.ins[h],0); k[3].querySelector(".n").firstChild.textContent=nf(nb.over[h]*100,0);
    $("kpiLbl").textContent=t("kpi.headNow",{h:fmtH(hour)});
  } else { const k=$("kpis").children[3], air=airResult(1,P.windDir,ON); if(k&&air) k.querySelector(".n").firstChild.textContent=nf(lerpArr(feelArr(RES.cur,air),hour),1); }
}

/* ================= interaksi ================= */
[...$("tabs").children].forEach(b=>b.onclick=()=>setAnalysis(b.dataset.a));
[...$("lang").children].forEach(b=>b.onclick=()=>setLang(b.dataset.l));
$("hour").oninput=e=>{hour=+e.target.value;updateFrame()};
$("spd").onchange=e=>speed=+e.target.value;
$("month").onchange=e=>{P.month=+e.target.value;buildPath();recomputeAll();renderCtrls();refreshPanel();updateFrame();};
const PLAY='<path d="M3 1.5v11l9-5.5z" fill="currentColor"/>', PAUSE='<path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor"/>';
function setPlay(p){playing=p;$("playIco").innerHTML=p?PAUSE:PLAY; $("play").setAttribute("aria-label",t(p?"tl.pause":"tl.play"));}
$("play").onclick=()=>setPlay(!playing);
function updateAudioBtn(){ const b=$("audioBtn"); b.setAttribute("aria-pressed",AU.on); b.querySelector("span").textContent=AU.on?t("aud.off"):t("aud.on"); }
$("audioBtn").onclick=()=>{AU.on?audioStop():audioStart(); updateAudioBtn();};
$("trainBtn").onclick=()=>{if(!train) spawnTrain();};
const ray=new THREE.Raycaster(), mv=new THREE.Vector2(), tip=$("tip");
function pick(e){
  const r=cvs.getBoundingClientRect(); mv.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
  ray.setFromCamera(mv,camera);
  if(zoneGroup.visible){const h=ray.intersectObjects(zmeshes,false)[0]; return h?{zi:h.object.userData.zi,r}:null;}
  if(luxGroup.visible){const vis=[1,2,3].filter(L=>luxMeshes[L].visible).map(L=>luxMeshes[L]);const h=ray.intersectObjects(vis,false)[0];
    if(h){const L=+Object.keys(luxMeshes).find(k=>luxMeshes[k]===h.object), i=luxIdx[L][Math.floor(h.face.a/4)];return {zi:dZone[i],pt:i,r};} }
  if(noiseGroup.visible){const vis=[1,2,3].filter(L=>nzMeshes[L].visible).map(L=>nzMeshes[L]).concat([siteTiles]);const h=ray.intersectObjects(vis,false)[0];
    if(h){ if(h.object===siteTiles) return {nz:NIN+Math.floor(h.face.a/4),zi:-1,r}; const L=+Object.keys(nzMeshes).find(k=>nzMeshes[k]===h.object), i=luxIdx[L][Math.floor(h.face.a/4)]; return {nz:i,zi:dZone[i],r}; } }
  if(airPlane.visible){const h=ray.intersectObject(airPlane,false)[0];
    if(h){const gx=(h.point.x-AIR.ox)/CS, gy=(-h.point.z-AIR.oy)/CS, c=(gy|0)*NX+(gx|0); if(c>=0&&c<NC) return {zi:ZID[c]===255?-1:ZID[c],cell:c,r};}}
  return null;
}
cvs.addEventListener("pointermove",e=>{
  const p=pick(e); if(!p){tip.hidden=true;cvs.style.cursor="";return}
  let h="";
  if(p.nz!==undefined){h='<b>'+nf(nzNow[p.nz],0)+' dB(A)</b><br>'+(p.zi>=0?zLabel(zones[p.zi])+' · '+zStorey(zones[p.zi]):t("tip.outside"));}
  else if(p.pt!==undefined){const j=Math.min(143,Math.round(hour*6));h='<b>'+nf(LUX.E[j*ND+p.pt],0)+' lux</b><br>'+zLabel(zones[p.zi])+' · '+t("tip.sky",{n:nf(dV[p.pt]/255*100,0)});}
  else if(p.cell!==undefined){if(SOL[p.cell]===1){h='<b>'+t("tip.wall")+'</b>';}else{const v=toMs(Math.hypot(UX[p.cell],UY[p.cell]));h='<b>'+nf(v,2)+' m/s</b><br>'+(p.zi>=0?zLabel(zones[p.zi]):t("tip.outside"));}}
  else {const z=zones[p.zi];h='<b>'+zLabel(z)+'</b> · '+zStorey(z)+'<br>'+(A==="suhu"?nf(lerpArr(SIMS.nv.res[p.zi].T,hour),1)+' °C':(z.outdoor?t("z.outArea"):nf(lerpArr(SIMS.ac.res[p.zi].Q,hour)/1000,1)+' kW'));}
  tip.hidden=false; tip.innerHTML=h; tip.style.left=Math.min(e.clientX-p.r.left+14,p.r.width-180)+"px"; tip.style.top=(e.clientY-p.r.top+14)+"px"; cvs.style.cursor="crosshair";
});
cvs.addEventListener("pointerleave",()=>tip.hidden=true);
cvs.addEventListener("click",e=>{const p=pick(e); if(p&&p.zi>=0&&p.cell===undefined){ if(selZone!==p.zi) selectZone(p.zi); }});
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();drawChart();}
new ResizeObserver(resize).observe(stage);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",drawChart);
document.addEventListener("keydown",e=>{ if(e.target.closest&&e.target.closest("input,select,textarea")) return;
  if(e.key===" "&&e.target===document.body){e.preventDefault();setPlay(!playing);}
  if(e.key==="Escape"&&!$("intro").hidden) closeIntro(); });

/* ---- pengantar ---- */
function renderIntro(){
  $("introBody").innerHTML='<p class="kick">'+t("intro.kick")+'</p><h2 id="introTitle">'+t("intro.title")+'</h2><p>'+t("intro.lead")+'</p>'+
    '<ol class="steps">'+[1,2,3].map(i=>'<li><b>'+t("intro.s"+i)+'</b><span>'+t("intro.s"+i+"d")+'</span></li>').join("")+'</ol>'+
    '<p class="small">'+t("intro.note")+'</p>';
  $("introGo").textContent=t("intro.go");
  $("introLang").innerHTML=Object.keys(I).map(l=>'<button data-l="'+l+'" aria-pressed="'+(l===LANG)+'">'+I[l]["lang.name"]+'</button>').join("");
  [...$("introLang").children].forEach(b=>b.onclick=()=>setLang(b.dataset.l));
}
function openIntro(){renderIntro(); $("intro").hidden=false; $("introGo").focus();}
function closeIntro(){$("intro").hidden=true; try{localStorage.setItem("fh-intro","1");}catch(e){}}
$("introGo").onclick=closeIntro; $("helpBtn").onclick=openIntro;
$("intro").addEventListener("click",e=>{if(e.target.id==="intro") closeIntro();});

/* ================= loop ================= */
let last=performance.now(), airPaint=0, airStatT=0;
function loop(ts){
  const dt=Math.min(0.1,(ts-last)/1000); last=ts;
  if(playing){hour=(hour+dt*speed)%24; updateFrame();}
  const prevHead=train?train.head:null;
  stepTraffic(dt); audioFrame(dt,train&&prevHead!==null?prevHead:null); stepFans(dt);
  if(A==="suara"&&!playing){ updateFrame(); }
  if(A==="udara"){
    const t0=performance.now(); let n=0;
    while(n<16&&performance.now()-t0<8){airStep(2);n+=2;}
    stepParticles(dt);
    if(++airPaint%6===0) paintAir();
    if(ts-airStatT>700){airStatT=ts; liveStats=airStatsFrom(airLevel,G1,UX,UY); if(!airResult(airLevel,P.windDir,ON)) refreshPanel();}
  }
  controls.update(); renderer.render(scene,camera);
  requestAnimationFrame(loop);
}
const RM=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if(RM) hour=12;
try{const s=(localStorage.getItem("fh-sol")||"").split(",").filter(x=>SOLBY[x]); s.forEach(x=>ON.add(x));}catch(e){}
const h0=(location.hash||"").slice(1);
buildPath(); recomputeAll();
buildSite("W"); applySolutions3D(); airInit(1);
setAnalysis(["model","energi","suhu","cahaya","udara","suara"].includes(h0)?h0:"model");
setPlay(!RM); resize(); updateFrame();
let introSeen=false; try{introSeen=localStorage.getItem("fh-intro")==="1";}catch(e){}
if(!introSeen&&!/[?&]nointro/.test(location.search)) openIntro();
window.__fh={ON,RES,IMP,metrics,fullMetrics,toggleSol,setLang,setAnalysis,airResult,AIRC,airJobs,get airJob(){return airJob},P,recomputeAll,refreshPanel,get A(){return A}};
requestAnimationFrame(loop);
})();
