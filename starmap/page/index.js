import { createWidget, widget, align, text_style, prop } from '@zos/ui'
import { push } from '@zos/router'
import { Compass, Accelerometer, Geolocation } from '@zos/sensor'
import { setPageBrightTime, pauseDropWristScreenOff, pausePalmScreenOff, setWakeUpRelaunch } from '@zos/display'
import { STARS, CONS } from '../utils/skydata'
import { dayNumber, sunPos, moonPos, planetPos, lstDeg, eqVec, PLANETS } from '../utils/astro'
import { equToDevice } from '../utils/sky'
import { OUTER, outerVec } from '../utils/outer'
import { drawGlyph } from '../utils/glyph'

const D2R=Math.PI/180,R2D=180/Math.PI// 度→ラジアン変換係数
const W=480,H=480,CX=240,CY=240,R=234
const FOV=38            // ARモードの視野角(度)。小さいほどズーム
const SCALE=R/Math.tan(FOV*Math.PI/360)// FOVから逆算した投影スケール
const ZMIN=Math.cos(FOV*D2R)// 視野角に対応するcos値。これより奥は非表示
const TICK=60           // メインループの間隔(ms)
const MININT=100        // ARの動作中の最短再描画間隔(ms)
const MININT_MAP=60     // MAPの動作中の最短再描画間隔(ms)
const VEL_AZ=0.30       // ARで「動いている」と判定する方位の変化速度
const VEL_G=0.007       // ARで「動いている」と判定する傾きの変化量
const VEL_MAP=0.12      // MAPでの動作判定(ARより緩い)
const STEP_AZ=0.35      // AR動作中の再描画しきい値(度)
const STEP_G=0.009      // AR動作中の再描画しきい値(傾き)
const STEP_MAP=0.15     // MAP動作中の再描画しきい値(度)
const CALM=3            // 静止判定に必要な連続tick数
const DECL_FIX=-0.3     // 磁気偏角の永年変化補正(国土地理院2020.0年値からのズレ分)
const AR_OFF=180            // ARモードのみに掛かる方位オフセット(現状0で不要)
const GSIGN=1           // 加速度センサーの符号
const VIEW=-1          // 視線の向き(-1:画面越しに空を覗くモデル)
const MIRX=1             // ARの左右反転補正(1:反転なし)
const HZDROP=12         // ARで地平線を画面下に何度分下げるか
const POOL=52           // ラベル(TEXTウィジェット)の同時表示数上限
const CACHE_H=1         // 太陽・月・惑星位置の再計算間隔(時間)
const SKY_SLOW=8        // 空の塗りつぶし走査線間隔(静止時)
const SKY_FAST=18       // 空の塗りつぶし走査線間隔(動作中)
const LW_HZ=2           // 地平線の線の太さ
const LW_EC=1           // 黄道の線の太さ
const PERF=0            // 描画時間などの診断表示 on/off
const TXT=16            // 星名・星座名などラベルの文字サイズ
const CARDSZ=22         // 方位(N/E/S/W)の文字サイズ
const STARSZ=22         // ★の基準サイズ
const STARK=2.2         // ★の等級ごとの縮小量
const MODE0=2           // 起動時の表示モード 0:AR 1:MAP90 2:MAP180 3:MAP360
const AUTOSW=0          // 傾きによるAR/MAP自動切替(1で有効、現在無効)
const RMAP=214          // MAPモードの地平線円の半径
const MAPROT=1          // MAPの回転基準(1:向いている方向が上 0:北が上)
const MAPSPIN=1         // MAP回転方向(逆なら-1)
const MAPALT=-3         // MAPで表示する最低高度(度)
const ZKEYS=['Ari','Tau','Gem','Cnc','Leo','Vir','Lib','Sco','Oph','Sgr','Cap','Aqr','Psc']

const C_SKY=0x0a1526
const C_HZ=0x00cfe0
const C_EC=0xff8c1a
const C_GRID=0x1c3145
const C_CN=[0x7fb4dc,0x3c4a56]
const C_ST=[0xffffff,0x5a5a5a]
const C_MN=[0xe8eef5,0x545c64]
const C_MD=0x2b3138
const C_PL=[0xffd27f,0x6b5734]
const C_SN=[0xffcc33,0x6a5518]
const C_DIR=0x9fe8f5

const R16=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
const CARD=[['N',0],['E',90],['S',180],['W',270]]

const ZC=[]
for(let i=0;i<CONS.length;i++) if(ZKEYS.indexOf(CONS[i].a)>=0) ZC.push(CONS[i])
function mkRing(st){const a=[]
  for(let d=0;d<360;d+=st){const r=d*D2R; a.push([Math.sin(r),Math.cos(r)])}
  return a}
const HZ_S=mkRing(6), HZ_F=mkRing(15)
function mkEcl(st){const a=[],ce=Math.cos(23.4393*D2R),se=Math.sin(23.4393*D2R)
  for(let l=0;l<360;l+=st){const r=l*D2R
    a.push([Math.cos(r),Math.sin(r)*ce,Math.sin(r)*se])}
  return a}
const EP_S=mkEcl(4), EP_F=mkEcl(8)
const CIRC=[]
for(let d=0;d<360;d+=5){const r=d*D2R; CIRC.push([Math.sin(r),Math.cos(r)])}

let canvas,labels=[],LC=[],dirTxt,clockTxt,perfTxt,errTxt,modeBtn,listBtn
let compass,accel,geo,timer,clkT=null,clkS=''
let lat=34.685,lon=135.805
let azF=0,sS=0,cS=1,gF={x:0,y:0,z:1}
let dAz=999,dG=[9,9,9],pAz=0,pG=[0,0,0]
let calm=0,locked=false,lastDraw=0,lastDir='',shown=false
let li=0,lastPaint=-1,boxes=[],calls=0
let CA=null,caD=-99,msAvg=0,perfS=''
let mode=MODE0
let curHalf=90,curZoom=2

function declW(la,lo){
  const p=la-37,q=lo-138
  return (495.822+18.462*p-7.726*q+0.007*p*p-0.007*p*q-0.655*q*q)/60
}
function decl(){ return -declW(lat,lon)+DECL_FIX }
function showErr(s){
  if(!errTxt)return
  errTxt.setProperty(prop.MORE,{x:20,y:180,w:440,h:160,text:String(s),
    text_size:20,color:0xff5566,align_h:align.LEFT,align_v:align.TOP})
  errTxt.setProperty(prop.VISIBLE,true)
}
function paint(c,lw){const k=c*8+lw; if(k!==lastPaint){canvas.setPaint({color:c,line_width:lw});lastPaint=k;calls++}}
function ln(x1,y1,x2,y2,c){calls++;canvas.drawLine({x1:x1|0,y1:y1|0,x2:x2|0,y2:y2|0,color:c})}
function dot(x,y,r,c){paint(c,1);calls++;canvas.drawCircle({center_x:x,center_y:y,radius:r,color:c})}
function pglyph(n,x,y,r,c){calls++;drawGlyph(canvas,n,x,y,r,c)}

function feedAz(a){
  let d=Math.abs(a-azF); if(d>180)d=360-d
  const al=d>20?0.35:(d>6?0.14:0.04)
  const r=a*D2R
  sS=sS*(1-al)+Math.sin(r)*al; cS=cS*(1-al)+Math.cos(r)*al
  azF=Math.atan2(sS,cS)*R2D
}
function feedG(c){
  const x=c.x*GSIGN,y=c.y*GSIGN,z=c.z*GSIGN
  const n=Math.sqrt(x*x+y*y+z*z)||1
  const nx=x/n,ny=y/n,nz=z/n
  const d=Math.abs(nx-gF.x)+Math.abs(ny-gF.y)+Math.abs(nz-gF.z)
  const al=d>0.35?0.35:(d>0.12?0.14:0.035)
  gF.x+=(nx-gF.x)*al; gF.y+=(ny-gF.y)*al; gF.z+=(nz-gF.z)*al
}
function devV(x,y,z,m){
  return [m[0]*x+m[1]*y+m[2]*z, m[3]*x+m[4]*y+m[5]*z, VIEW*(m[6]*x+m[7]*y+m[8]*z)]
}
const HC=Math.cos(HZDROP*D2R), HS=Math.sin(HZDROP*D2R)
function tilt(v){ return [v[0], v[1]*HC-v[2]*HS, v[1]*HS+v[2]*HC] }
function projEq(x,y,z,m){
  const v=tilt(devV(x,y,z,m))
  if(v[2]<ZMIN)return null
  const k=SCALE/(1+v[2])
  return {x:(CX+MIRX*k*v[0])|0,y:(CY-k*v[1])|0,v:v}
}
function hideAll(){
  for(let i=0;i<POOL;i++) if(LC[i].v){labels[i].setProperty(prop.VISIBLE,false);LC[i].v=false}
  shown=false
}
function label(t,x,y,c,s){
  if(li>=POOL)return
  const w=t.length*s*0.62,h=s+4
  for(let i=0;i<boxes.length;i++){
    const b=boxes[i]
    if(Math.abs(x-b[0])<(w+b[2])*0.5&&Math.abs(y-b[1])<(h+b[3])*0.5)return
  }
  boxes.push([x,y,w,h])
  const o=LC[li]
  if(!(o.v&&o.t===t&&o.c===c&&o.s===s&&o.x===x&&o.y===y)){
    labels[li].setProperty(prop.MORE,{x:x-110,y:y-((s+10)>>1),w:220,h:s+10,
      text:t,color:c,text_size:s,align_h:align.CENTER_H})
    if(!o.v)labels[li].setProperty(prop.VISIBLE,true)
    o.t=t;o.x=x;o.y=y;o.c=c;o.s=s;o.v=true
  }
  li++
}
function moonDisc(x,y,r,q,th){
  dot(x,y,r,C_MD)
  const ct=Math.cos(th),st=Math.sin(th)
  paint(C_MN[0],3)
  for(let t=-r+1;t<=r-1;t+=2){
    const w=Math.sqrt(r*r-t*t), u1=-q*w, u2=w
    if(u2-u1<1)continue
    ln(x+u1*ct-t*st,y+u1*st+t*ct,x+u2*ct-t*st,y+u2*st+t*ct,C_MN[0])
  }
}
function cache(d){
  if(CA&&Math.abs(d-caD)<CACHE_H/24)return CA
  const sun=sunPos(d), sv=eqVec(sun.ra,sun.dec)
  const mo=moonPos(d,sun), mv=eqVec(mo.ra,mo.dec)
  const pl=[]
  for(let i=0;i<PLANETS.length;i++){
    const q=planetPos(PLANETS[i],d,sun)
    pl.push([PLANETS[i],eqVec(q.ra,q.dec)])
  }
  for(let i=0;i<OUTER.length;i++) pl.push([OUTER[i],outerVec(OUTER[i],d)])
  CA={sun:sun,sv:sv,mv:mv,mq:-(mv[0]*sv[0]+mv[1]*sv[1]+mv[2]*sv[2]),pl:pl}
  caD=d
  return CA
}

/* ---------------- AR モード ---------------- */
function fillSky(hb,step){
  const uu=tilt([hb.u[0],hb.u[1],VIEW*hb.u[2]])
  const a=uu[0],b=uu[1]
  let c=uu[2]
  if(Math.abs(c)<0.02)c=c>=0?0.02:-0.02
  const px=a/c,py=b/c
  const cx=CX+MIRX*SCALE*px, cy=CY-SCALE*py
  const rr=SCALE*Math.sqrt(px*px+py*py+1)
  const ins=c>0
  paint(C_SKY,step+1)
  for(let y=(step>>1);y<H;y+=step){
    const dy=y-cy, t=rr*rr-dy*dy
    if(t<=0){ if(!ins)ln(0,y,W,y,C_SKY); continue }
    const w=Math.sqrt(t), x1=cx-w, x2=cx+w
    if(ins){
      const a1=x1<0?0:x1, a2=x2>W?W:x2
      if(a2>a1)ln(a1,y,a2,y,C_SKY)
    }else{
      if(x1>0)ln(0,y,x1>W?W:x1,y,C_SKY)
      if(x2<W)ln(x2<0?0:x2,y,W,y,C_SKY)
    }
  }
}
function eclipticRing(m,arr){
  paint(C_EC,LW_EC)
  let pp=null
  for(let i=0;i<=arr.length;i++){
    const e=arr[i%arr.length]
    const p=projEq(e[0],e[1],e[2],m)
    if(p&&pp)ln(pp.x,pp.y,p.x,p.y,C_EC)
    pp=p
  }
}
function horizonRing(hb,arr){
  paint(C_HZ,LW_HZ)
  let pp=null
  for(let i=0;i<=arr.length;i++){
    const e=arr[i%arr.length]
    const q=tilt([e[0]*hb.e[0]+e[1]*hb.n[0], e[0]*hb.e[1]+e[1]*hb.n[1],
                  VIEW*(e[0]*hb.e[2]+e[1]*hb.n[2])])
    let p=null
    if(q[2]>=ZMIN){const k=SCALE/(1+q[2])
      p={x:(CX+MIRX*k*q[0])|0,y:(CY-k*q[1])|0}}
    if(p&&pp)ln(pp.x,pp.y,p.x,p.y,C_HZ)
    pp=p
  }
}
function drawAR(az,gv,full){
  const d=dayNumber(new Date())
  const K=cache(d)
  const T=equToDevice(lstDeg(d,K.sun.L,lon),lat,az+decl()+AR_OFF,{x:gv[0],y:gv[1],z:gv[2]})
  const m=T.m,U=T.u,hb=T.hb
  const up=v=>(U[0]*v[0]+U[1]*v[1]+U[2]*v[2])>0

  fillSky(hb,full?SKY_SLOW:SKY_FAST)
  eclipticRing(m,full?EP_S:EP_F)
  horizonRing(hb,full?HZ_S:HZ_F)

  const sp=projEq(K.sv[0],K.sv[1],K.sv[2],m)
  if(sp){const c=up(K.sv)?C_SN[0]:C_SN[1]
    label('\u2609',sp.x,sp.y,c,34); label('Sun',sp.x,sp.y+30,c,TXT)}

  const mp=projEq(K.mv[0],K.mv[1],K.mv[2],m)
  if(mp){const u=up(K.mv)
    if(u){
      const sd=tilt(devV(K.sv[0],K.sv[1],K.sv[2],m))
      moonDisc(mp.x,mp.y,14,K.mq,Math.atan2(-(sd[1]-mp.v[1]),MIRX*(sd[0]-mp.v[0])))
      label('Moon '+Math.round((1+K.mq)*50)+'%',mp.x,mp.y+30,C_MN[0],TXT)
    }else{
      dot(mp.x,mp.y,9,C_MN[1])
      label('Moon '+Math.round((1+K.mq)*50)+'%',mp.x,mp.y+26,C_MN[1],TXT)
    }}

  for(let i=0;i<K.pl.length;i++){
    const v=K.pl[i][1], p=projEq(v[0],v[1],v[2],m)
    if(!p)continue
    const c=up(v)?C_PL[0]:C_PL[1]
    pglyph(K.pl[i][0],p.x,p.y,9,c)
    label(K.pl[i][0],p.x,p.y+(p.y>430?-30:28),c,TXT)
  }
  for(let i=0;i<STARS.length;i++){
    const s=STARS[i], p=projEq(s[1],s[2],s[3],m)
    if(!p)continue
    const c=up([s[1],s[2],s[3]])?C_ST[0]:C_ST[1]
    const sz=Math.round(STARSZ-(s[4]+1.5)*STARK)
    label('\u2605',p.x,p.y,c,sz); label(s[0],p.x,p.y+(sz>>1)+17,c,TXT)
  }
  for(let i=0;i<ZC.length;i++){
    const z=ZC[i], p=projEq(z.c[0],z.c[1],z.c[2],m)
    if(!p)continue
    const c=up(z.c)?C_CN[0]:C_CN[1]
    pglyph(z.a,p.x,p.y,15,c); label(z.n,p.x,p.y+25,c,TXT)
  }

  const vE=VIEW*hb.e[2], vN=VIEW*hb.n[2], vU=VIEW*hb.u[2]
  let a2=Math.atan2(vE,vN)*R2D; if(a2<0)a2+=360
  return R16[Math.round(a2/22.5)%16]+' '+Math.round(a2)+'\u00B0  '
        +(vU>=0?'+':'')+Math.round(Math.asin(vU>1?1:(vU<-1?-1:vU))*R2D)+'\u00B0'
}

/* ---------------- 星座盤モード ---------------- */
let mE,mN,mU,mRot,noStroke=false
function fanXY(rel,r){
  const th=MAPSPIN*rel*curZoom*D2R
  return {x:(CX+r*Math.sin(th))|0, y:(CY-r*Math.cos(th))|0}
}
function projMap(v){
  const uu=v[0]*mU[0]+v[1]*mU[1]+v[2]*mU[2]
  const alt=Math.asin(uu>1?1:(uu<-1?-1:uu))*R2D
  if(alt<MAPALT)return null
  const ee=v[0]*mE[0]+v[1]*mE[1]+v[2]*mE[2]
  const nn=v[0]*mN[0]+v[1]*mN[1]+v[2]*mN[2]
  let rel=Math.atan2(ee,nn)*R2D-mRot
  rel=((rel+540)%360)-180
  if(curHalf<180&&(rel>curHalf||rel<-curHalf))return null
  return fanXY(rel,RMAP*(90-alt)/90)
}
function mapCircle(rad,col,lw){
  paint(col,lw)
  if(!noStroke&&canvas.strokeCircle){
    try{calls++
      canvas.strokeCircle({center_x:CX,center_y:CY,radius:rad,color:col})
      return}catch(e){noStroke=true}
  }
  let pp=null
  for(let i=0;i<=CIRC.length;i++){
    const e=CIRC[i%CIRC.length]
    const p={x:(CX+rad*e[0])|0,y:(CY-rad*e[1])|0}
    if(pp)ln(pp.x,pp.y,p.x,p.y,col)
    pp=p
  }
}
function drawMap(az,full){
  const d=dayNumber(new Date())
  const K=cache(d)
  const lst=lstDeg(d,K.sun.L,lon)
  const cl=Math.cos(lst*D2R), sl=Math.sin(lst*D2R)
  const cp=Math.cos(lat*D2R), sp=Math.sin(lat*D2R)
  mE=[-sl,cl,0]; mN=[-sp*cl,-sp*sl,cp]; mU=[cp*cl,cp*sl,sp]
  mRot=MAPROT?(az+decl()):0

  const SECT=[0,90,180,360]
  const sector=SECT[mode]||180
  curHalf=sector/2
  curZoom=sector<360?180/curHalf:1

  const step=full?SKY_SLOW:SKY_FAST
  dot(CX,CY,RMAP,C_SKY)
  mapCircle(RMAP/3,C_GRID,1)
  mapCircle(RMAP*2/3,C_GRID,1)

  paint(C_EC,LW_EC)
  {const arr=full?EP_S:EP_F
   let pp=null
   for(let i=0;i<=arr.length;i++){
     const p=projMap(arr[i%arr.length])
     if(p&&pp)ln(pp.x,pp.y,p.x,p.y,C_EC)
     pp=p
   }}
  mapCircle(RMAP,C_HZ,LW_HZ)

  for(let i=0;i<4;i++){
    let rel=CARD[i][1]-mRot
    rel=((rel+540)%360)-180
    if(curHalf<180&&(rel>curHalf||rel<-curHalf))continue
    const q=fanXY(rel,RMAP-26)
    label(CARD[i][0],q.x,q.y,C_HZ,CARDSZ)
  }
  paint(C_GRID,1)
  ln(CX-9,CY,CX+9,CY,C_GRID); ln(CX,CY-9,CX,CY+9,C_GRID)

  const sp2=projMap(K.sv)
  if(sp2){label('\u2609',sp2.x,sp2.y,C_SN[0],34); label('Sun',sp2.x,sp2.y+30,C_SN[0],TXT)}
  const mp=projMap(K.mv)
  if(mp){
    const sx=sp2?sp2.x:CX, sy=sp2?sp2.y:CY
    moonDisc(mp.x,mp.y,14,K.mq,Math.atan2(-(sy-mp.y),sx-mp.x))
    label('Moon '+Math.round((1+K.mq)*50)+'%',mp.x,mp.y+30,C_MN[0],TXT)
  }
  for(let i=0;i<K.pl.length;i++){
    const p=projMap(K.pl[i][1])
    if(!p)continue
    pglyph(K.pl[i][0],p.x,p.y,9,C_PL[0])
    label(K.pl[i][0],p.x,p.y+(p.y>430?-30:28),C_PL[0],TXT)
  }
  for(let i=0;i<STARS.length;i++){
    const s=STARS[i], p=projMap([s[1],s[2],s[3]])
    if(!p)continue
    const sz=Math.round(STARSZ-(s[4]+1.5)*STARK)
    label('\u2605',p.x,p.y,C_ST[0],sz)
    label(s[0],p.x,p.y+(sz>>1)+17,C_ST[0],TXT)
  }
  for(let i=0;i<ZC.length;i++){
    const z=ZC[i], p=projMap(z.c)
    if(!p)continue
    pglyph(z.a,p.x,p.y,15,C_CN[0]); label(z.n,p.x,p.y+25,C_CN[0],TXT)
  }
  let a2=az+decl(); a2=((a2%360)+360)%360
  return 'MAP'+sector+'  '+R16[Math.round(a2/22.5)%16]+' '+Math.round(a2)+'\u00B0'
}

/* ---------------- 共通 ---------------- */
function draw(az,gv,full){
  const t0=Date.now()
  calls=1
  canvas.clear({x:0,y:0,w:W,h:H})
  lastPaint=-1; li=0; boxes=[]
  let s2
  if(mode)s2=drawMap(az,full)
  else s2=drawAR(az,gv,full)
  for(let i=li;i<POOL;i++) if(LC[i].v){labels[i].setProperty(prop.VISIBLE,false);LC[i].v=false}
  shown=true
  if(s2!==lastDir){
    dirTxt.setProperty(prop.MORE,{x:40,y:24,w:400,h:34,text:s2,
      text_size:26,color:C_DIR,align_h:align.CENTER_H})
    lastDir=s2
  }
  if(PERF&&perfTxt){
    msAvg=msAvg*0.7+(Date.now()-t0)*0.3
    const t=Math.round(msAvg)+'ms '+calls+'c'+(full?' F':'')
    if(t!==perfS){perfS=t
      perfTxt.setProperty(prop.MORE,{x:20,y:376,w:440,h:34,text:t,
        text_size:22,color:0xffe066,align_h:align.CENTER_H})}
  }
}
function redraw(){
  locked=false; calm=0; dAz=999; lastDir=''
  draw(azF,[gF.x,gF.y,gF.z],true)
}
function tick(){
  try{
    if(AUTOSW){
      const m2=gF.z>0.80?(mode===0?1:mode):(gF.z<0.60?0:mode)
      if(m2!==mode){mode=m2; setBtn(); redraw(); return}
    }
    let vA=Math.abs(azF-pAz); if(vA>180)vA=360-vA
    const vG=mode?0:(Math.abs(gF.x-pG[0])+Math.abs(gF.y-pG[1])+Math.abs(gF.z-pG[2]))
    pAz=azF; pG[0]=gF.x; pG[1]=gF.y; pG[2]=gF.z
    if(vA>(mode?VEL_MAP:VEL_AZ)||vG>VEL_G){
      calm=0; locked=false
      const now=Date.now()
      if(now-lastDraw<(mode?MININT_MAP:MININT))return
      let dA=Math.abs(azF-dAz); if(dA>180)dA=360-dA
      const dGv=mode?0:(Math.abs(gF.x-dG[0])+Math.abs(gF.y-dG[1])+Math.abs(gF.z-dG[2]))
      if(dA<(mode?STEP_MAP:STEP_AZ)&&dGv<STEP_G)return
      lastDraw=now
      dAz=azF; dG[0]=gF.x; dG[1]=gF.y; dG[2]=gF.z
      draw(dAz,dG,false)
      return
    }
    if(locked)return
    calm++
    if(calm<CALM)return
    locked=true; lastDraw=Date.now()
    dAz=azF; dG[0]=gF.x; dG[1]=gF.y; dG[2]=gF.z
    draw(dAz,dG,true)
  }catch(e){showErr('DRAW '+e)}
}
function setBtn(){
  if(!modeBtn)return
  const LBL=['AR','MAP90','MAP180','MAP360']
  const lbl=LBL[mode]||'AR'
  const sz=mode===0?24:18
  try{modeBtn.setProperty(prop.MORE,{x:138,y:412,w:96,h:44,
    text:lbl,text_size:sz,radius:22,
    normal_color:0x16202c,press_color:0x2d4358,color:C_DIR})}catch(e){}
}

Page({
  build(){
    try{setWakeUpRelaunch({relaunch:true})}catch(e){}
    try{setPageBrightTime({brightTime:600000})}catch(e){}
    try{pauseDropWristScreenOff({duration:0})}catch(e){}
    try{pausePalmScreenOff({duration:0})}catch(e){}
    try{
      createWidget(widget.FILL_RECT,{x:0,y:0,w:W,h:H,color:0x000000})
      canvas=createWidget(widget.CANVAS,{x:0,y:0,w:W,h:H})
      for(let i=0;i<POOL;i++){
        labels.push(createWidget(widget.TEXT,{x:0,y:0,w:220,h:30,text:'',
          text_size:18,color:0xffffff,align_h:align.CENTER_H,
          align_v:align.CENTER_V,text_style:text_style.NONE}))
        labels[i].setProperty(prop.VISIBLE,false)
        LC.push({v:false})
      }
      dirTxt=createWidget(widget.TEXT,{x:40,y:24,w:400,h:34,text:'',
        text_size:26,color:C_DIR,align_h:align.CENTER_H,
        align_v:align.CENTER_V,text_style:text_style.NONE})
      clockTxt=createWidget(widget.TEXT,{x:20,y:62,w:440,h:28,text:'',
        text_size:19,color:0x8fa3b8,align_h:align.CENTER_H,
        align_v:align.CENTER_V,text_style:text_style.NONE})
      perfTxt=createWidget(widget.TEXT,{x:20,y:376,w:440,h:34,text:'',
        text_size:22,color:0xffe066,align_h:align.CENTER_H,
        align_v:align.CENTER_V,text_style:text_style.NONE})
      perfTxt.setProperty(prop.VISIBLE,PERF?true:false)
      errTxt=createWidget(widget.TEXT,{x:20,y:180,w:440,h:160,text:'',
        text_size:20,color:0xff5566,align_h:align.LEFT,align_v:align.TOP,
        text_style:text_style.WRAP})
      errTxt.setProperty(prop.VISIBLE,false)
    }catch(e){showErr('UI '+e);return}

    try{
      modeBtn=createWidget(widget.BUTTON,{x:138,y:412,w:96,h:44,
        text:'MAP180',text_size:18,radius:22,
        normal_color:0x16202c,press_color:0x2d4358,color:C_DIR,
        click_func:()=>{mode=(mode+1)%4; setBtn(); redraw()}})
      listBtn=createWidget(widget.BUTTON,{x:246,y:412,w:96,h:44,
        text:'LIST',text_size:22,radius:22,
        normal_color:0x16202c,press_color:0x2d4358,color:C_DIR,
        click_func:()=>{try{push({url:'page/list'})}catch(e){}}})
    }catch(e){modeBtn=null}
    setBtn()

    try{
      compass=new Compass()
      compass.start&&compass.start()
      compass.onChange(()=>{const a=compass.getDirectionAngle(); if(typeof a==='number')feedAz(a)})
    }catch(e){showErr('COMPASS '+e)}
    try{
      accel=new Accelerometer()
      accel.start&&accel.start()
      accel.onChange(()=>{const c=accel.getCurrent(); if(c)feedG(c)})
    }catch(e){showErr('ACCEL '+e)}
    try{
      geo=new Geolocation()
      geo.start&&geo.start()
      geo.onChange(()=>{
        if(geo.getStatus()!=='A')return
        lat=geo.getLatitude({format:'DD'}); lon=geo.getLongitude({format:'DD'})
        CA=null; locked=false; geo.stop&&geo.stop()
      })
    }catch(e){}

    const p2=n=>(n<10?'0':'')+n
    const clock=()=>{
      const t=new Date()
      const v=t.getFullYear()+'/'+p2(t.getMonth()+1)+'/'+p2(t.getDate())
        +'  '+p2(t.getHours())+':'+p2(t.getMinutes())+':'+p2(t.getSeconds())
      if(v!==clkS){clkS=v
        clockTxt.setProperty(prop.MORE,{x:20,y:62,w:440,h:28,text:v,
          text_size:19,color:0x8fa3b8,align_h:align.CENTER_H})}
    }
    clock()
    try{clkT=setInterval(clock,1000)}catch(e){}
    draw(azF,[gF.x,gF.y,gF.z],true)
    try{timer=setInterval(tick,TICK)}catch(e){showErr('TIMER '+e)}
  },
  onDestroy(){
    if(timer){clearInterval(timer);timer=null}
    if(clkT){clearInterval(clkT);clkT=null}
    compass&&compass.stop&&compass.stop()
    accel&&accel.stop&&accel.stop()
    geo&&geo.stop&&geo.stop()
  }
})
