import { createWidget, widget, align, text_style, prop, event } from '@zos/ui'
import { push } from '@zos/router'
import { Compass, Accelerometer, Geolocation } from '@zos/sensor'
import { setPageBrightTime, pauseDropWristScreenOff, pausePalmScreenOff, setWakeUpRelaunch } from '@zos/display'
import { onGesture, offGesture, GESTURE_LEFT, GESTURE_RIGHT, GESTURE_UP, GESTURE_DOWN } from '@zos/interaction'
import { STARS, DOTS, CONS } from '../utils/skydata'
import { dayNumber, sunPos, moonPos, planetPos, lstDeg, eqVec, PLANETS } from '../utils/astro'
import { equToDevice } from '../utils/sky'
import { OUTER, outerVec } from '../utils/outer'
import { drawGlyph } from '../utils/glyph'
import { getState, saveState } from '../utils/state'

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
const POOL=60           // ラベル(TEXTウィジェット)の同時表示数上限
const CACHE_H=1         // 太陽・月・惑星位置の再計算間隔(時間)
const SKY_SLOW=8        // 空の塗りつぶし走査線間隔(静止時)
const SKY_FAST=18       // 空の塗りつぶし走査線間隔(動作中)
const LW_HZ=2           // 地平線の線の太さ
const LW_EC=1           // 黄道の線の太さ
const PERF=0            // 描画時間などの診断表示 on/off
const TXT=16            // 星名・星座名などラベルの文字サイズ
const TXT_CN=15         // 黄道外の星座名の文字サイズ
const CARDSZ=22         // 方位(N/E/S/W)の文字サイズ
const STARSZ=22         // \u2605の基準サイズ
const STARK=2.2         // \u2605の等級ごとの縮小量
const MODE0=2           // 起動時の表示モード 0:AR 1:MAP90 2:MAP180 3:MAP360
const AUTOSW=0          // 傾きによるAR/MAP自動切替(1で有効、現在無効)
const RMAP=214          // MAPモードの地平線円の半径
const MAPROT=1          // MAPの回転基準(1:向いている方向が上 0:北が上)
const MAPSPIN=1         // MAP回転方向(逆なら-1)
const MAPALT=-3         // MAPで表示する最低高度(度)
const LINES=1           // 星座線 on/off
const LINES_FAST=[1,1,0,0]// 動いている間も星座線と星座名を描くか(AR,MAP90,MAP180,MAP360)。0なら止まってから描く
const DOTMAG=3.5        // 星座線の星を点で描く等級の限界
const REFRESH=30000     // 止まっていても空を描き直す間隔(ms)。時刻の進みに合わせるため
const NIGHT_H=21        // 時計をタップしたときに飛ぶ時刻(次のこの時刻)
const DRAG_K=0.3        // TOUCHのドラッグ感度(度/px)
const TAPPX=14          // これより動かなければタップとみなす(px)
const TAP_AZ=30         // TOUCHで画面の左右をタップしたときの回転量(度)
const TAP_ALT=15        // ARのTOUCHで画面の上下をタップしたときの高度の変化(度)
const SWIPE_AZ=45       // TOUCHでスワイプ(ジェスチャー)したときの回転量(度)
const ALT0=10           // TOUCHのAR開始時の高度(度)。地平線がボタンの少し上に来る
const MININT_T=80       // TOUCHの操作中の最短再描画間隔(ms)
const ZKEYS=['Ari','Tau','Gem','Cnc','Leo','Vir','Lib','Sco','Oph','Sgr','Cap','Aqr','Psc']

const C_SKY=0x0a1526
const C_HZ=0x00cfe0
const C_EC=0xff8c1a
const C_GRID=0x1c3145
const C_CN=[0x7fb4dc,0x3c4a56]
const C_CN2=[0x56789a,0x333d47]
const C_LN=[0x2c5374,0x1d2833]
const C_DOT=[0xc9d7e6,0x4a525a]
const C_ST=[0xffffff,0x5a5a5a]
const C_MN=[0xe8eef5,0x545c64]
const C_MD=0x2b3138
const C_PL=[0xffd27f,0x6b5734]
const C_SN=[0xffcc33,0x6a5518]
const C_DIR=0x9fe8f5
const C_CLK=0x8fa3b8
const C_SIM=0xffb347    // 時間をずらしているときの色
const C_BTN=0x16202c,C_BTNP=0x2d4358
// ボタンの位置 [x,y,w,h,角の丸み]。時刻を進める・戻すボタンは、空を隠しにくい左右の端に置く
const B_MODE=[116,400,80,44,22],B_TOUCH=[200,400,80,44,22],B_LIST=[284,400,80,44,22]
const B_CLOCK=[148,60,184,38,19],B_BACK=[4,214,50,52,24],B_FWD=[426,214,50,52,24]

const R16=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
const CARD=[['N',0],['E',90],['S',180],['W',270]]

const ZC=[],OC=[]
for(let i=0;i<CONS.length;i++) (ZKEYS.indexOf(CONS[i].a)>=0?ZC:OC).push(CONS[i])
const ND=DOTS.length>>2
const PX=new Array(ND).fill(0),PY=new Array(ND).fill(0),PV=new Array(ND).fill(0)
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

let canvas,labels=[],LC=[],dirTxt,clockBtn,perfTxt,errTxt,modeBtn,listBtn,touchBtn,touchPad
let compass,accel,geo,timer,clkT=null,clkS=''
let lat=34.685,lon=135.805
let azF=0,sS=0,cS=1,gF={x:0,y:0,z:1}
let dAz=999,dG=[9,9,9],pAz=0,pG=[0,0,0]
let calm=0,locked=false,lastDraw=0,lastDir='',shown=false
let li=0,lastPaint=-1,boxes=[],calls=0
let CA=null,caD=-99,msAvg=0,perfS=''
let mode=MODE0
let curHalf=90,curZoom=2
let simT=null           // 時間移動中の時刻(ms)。nullなら今の時刻
let touch=false,manAz=180,manAlt=ALT0,dirty=0
let tDown=null,tLast=null,tMoved=false,lastTouch=0

function declW(la,lo){
  const p=la-37,q=lo-138
  return (495.822+18.462*p-7.726*q+0.007*p*p-0.007*p*q-0.655*q*q)/60
}
function decl(){ return -declW(lat,lon)+DECL_FIX }
function norm360(a){ return ((a%360)+360)%360 }
function simNow(){ return simT==null?new Date():new Date(simT) }
function save(){ saveState({mode:mode,touch:touch,manAz:manAz,manAlt:manAlt,simT:simT}) }
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

/* ---------------- 星座線（AR・MAP共通） ----------------
   PX,PY,PV に星座線の星の画面位置を入れてから呼ぶ。PV: 0=見えない 1=地平線の下 2=地平線の上 */
function consLines(){
  for(let k=0;k<2;k++){
    const c=C_LN[k]
    paint(c,1)
    for(let i=0;i<CONS.length;i++){
      const L=CONS[i].l
      for(let j=0;j<L.length;j++){
        const p=L[j]
        for(let n=1;n<p.length;n++){
          const a=p[n-1],b=p[n]
          if(!PV[a]||!PV[b])continue
          if((PV[a]===2&&PV[b]===2)!==(k===0))continue
          ln(PX[a],PY[a],PX[b],PY[b],c)
        }
      }
    }
  }
  for(let i=0;i<ND;i++){
    if(!PV[i])continue
    const mg=DOTS[i*4+3]
    if(mg>DOTMAG)continue
    dot(PX[i],PY[i],mg<1.5?3:(mg<2.5?2:1),C_DOT[PV[i]===2?0:1])
  }
}
function consNames(prj,up){
  for(let i=0;i<OC.length;i++){
    const z=OC[i], p=prj(z.c)
    if(!p)continue
    label(z.n,p.x,p.y,C_CN2[up(z.c)?0:1],TXT_CN)
  }
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
function projDotsAR(m,U){
  for(let i=0;i<ND;i++){
    const x=DOTS[i*4],y=DOTS[i*4+1],z=DOTS[i*4+2]
    const v0=m[0]*x+m[1]*y+m[2]*z, v1=m[3]*x+m[4]*y+m[5]*z, v2=VIEW*(m[6]*x+m[7]*y+m[8]*z)
    const w1=v1*HC-v2*HS, w2=v1*HS+v2*HC
    if(w2<ZMIN){PV[i]=0;continue}
    const k=SCALE/(1+w2)
    PX[i]=(CX+MIRX*k*v0)|0; PY[i]=(CY-k*w1)|0
    PV[i]=(U[0]*x+U[1]*y+U[2]*z)>0?2:1
  }
}
function drawAR(az,gv,full){
  const d=dayNumber(simNow())
  const K=cache(d)
  // TOUCHでは、向き(manAz)と高さ(manAlt)から時計の姿勢を作る。
  // 画面越しの視線の方位は「equToDeviceに渡す角度+180」になる
  const g=touch?[0,Math.cos(manAlt*D2R),-Math.sin(manAlt*D2R)]:gv
  const A=touch?manAz+180:az+decl()+AR_OFF
  const T=equToDevice(lstDeg(d,K.sun.L,lon),lat,A,{x:g[0],y:g[1],z:g[2]})
  const m=T.m,U=T.u,hb=T.hb
  const up=v=>(U[0]*v[0]+U[1]*v[1]+U[2]*v[2])>0
  const cons=LINES&&(full||LINES_FAST[mode])

  fillSky(hb,full?SKY_SLOW:SKY_FAST)
  if(cons){projDotsAR(m,U); consLines()}
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
  if(cons)consNames(v=>projEq(v[0],v[1],v[2],m),up)

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
function projDotsMap(){
  const t=[0,0,0]
  for(let i=0;i<ND;i++){
    t[0]=DOTS[i*4]; t[1]=DOTS[i*4+1]; t[2]=DOTS[i*4+2]
    const p=projMap(t)
    if(!p){PV[i]=0;continue}
    PX[i]=p.x; PY[i]=p.y; PV[i]=2
  }
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
  const d=dayNumber(simNow())
  const K=cache(d)
  const lst=lstDeg(d,K.sun.L,lon)
  const cl=Math.cos(lst*D2R), sl=Math.sin(lst*D2R)
  const cp=Math.cos(lat*D2R), sp=Math.sin(lat*D2R)
  mE=[-sl,cl,0]; mN=[-sp*cl,-sp*sl,cp]; mU=[cp*cl,cp*sl,sp]
  mRot=touch?manAz:(MAPROT?(az+decl()):0)

  const SECT=[0,90,180,360]
  const sector=SECT[mode]||180
  curHalf=sector/2
  curZoom=sector<360?180/curHalf:1
  const cons=LINES&&(full||LINES_FAST[mode])

  dot(CX,CY,RMAP,C_SKY)
  mapCircle(RMAP/3,C_GRID,1)
  mapCircle(RMAP*2/3,C_GRID,1)
  if(cons){projDotsMap(); consLines()}

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
  if(cons)consNames(projMap,()=>true)
  const a2=norm360(mRot)
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
  lastDraw=Date.now()
  draw(azF,[gF.x,gF.y,gF.z],true)
}
function tickTouch(){
  const now=Date.now()
  if(dirty){
    if(now-lastDraw<MININT_T)return
    dirty=0; calm=0; locked=false; lastDraw=now
    draw(0,null,false)
    return
  }
  if(!locked){
    if(++calm<CALM)return
    locked=true; lastDraw=now
    draw(0,null,true)
    return
  }
  if(simT==null&&now-lastDraw>REFRESH){lastDraw=now; draw(0,null,true)}
}
function tick(){
  try{
    if(touch){tickTouch();return}
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
    if(locked){
      // 止まっていても、時刻が進んだ分だけ空を描き直す
      const now=Date.now()
      if(simT==null&&now-lastDraw>REFRESH){lastDraw=now; draw(dAz,dG,true)}
      return
    }
    calm++
    if(calm<CALM)return
    locked=true; lastDraw=Date.now()
    dAz=azF; dG[0]=gF.x; dG[1]=gF.y; dG[2]=gF.z
    draw(dAz,dG,true)
  }catch(e){showErr('DRAW '+e)}
}
function bopt(g,t,sz,c){
  return {x:g[0],y:g[1],w:g[2],h:g[3],text:t,text_size:sz,radius:g[4],
    normal_color:C_BTN,press_color:C_BTNP,color:c}
}
function btn(o,g,t,sz,c){ try{o.setProperty(prop.MORE,bopt(g,t,sz,c))}catch(e){} }
function mkBtn(g,t,sz,c,f,lf){
  const o=bopt(g,t,sz,c); o.click_func=f
  // 長押し(longpress_func)が使えない機種でも、ボタン自体は作る
  if(lf){try{return createWidget(widget.BUTTON,Object.assign({longpress_func:lf},o))}catch(e){}}
  return createWidget(widget.BUTTON,o)
}
function setBtn(){
  const LBL=['AR','MAP90','MAP180','MAP360']
  if(modeBtn)btn(modeBtn,B_MODE,LBL[mode]||'AR',mode===0?24:18,C_DIR)
  if(touchBtn)btn(touchBtn,B_TOUCH,touch?'TOUCH':'SENSOR',18,touch?C_SIM:C_DIR)
  if(touchPad)try{touchPad.setProperty(prop.VISIBLE,touch)}catch(e){}
}

/* ---------------- 時間移動 ---------------- */
const p2=n=>(n<10?'0':'')+n
function clock(){
  const t=simNow()
  let v=p2(t.getMonth()+1)+'/'+p2(t.getDate())+'  '+p2(t.getHours())+':'+p2(t.getMinutes())
  if(simT==null)v+=':'+p2(t.getSeconds())
  if(v!==clkS){clkS=v; btn(clockBtn,B_CLOCK,v,18,simT==null?C_CLK:C_SIM)}
}
function setSim(t){
  simT=t; save(); clock()
  try{redraw()}catch(e){showErr('DRAW '+e)}
}
// h時間ずらして、いちばん近いちょうどの時刻(○時00分)にそろえる
function shiftH(h){
  const d=new Date((simT==null?Date.now():simT)+h*3600000+1800000)
  d.setMinutes(0,0,0)
  setSim(d.getTime())
}
// 今の時刻 → 次の NIGHT_H 時 → 今の時刻 …
function toggleNight(){
  if(simT!=null){setSim(null);return}
  const d=new Date()
  if(d.getHours()>=NIGHT_H)d.setDate(d.getDate()+1)
  d.setHours(NIGHT_H,0,0,0)
  setSim(d.getTime())
}

/* ---------------- TOUCH（指で見回す） ---------------- */
function turn(da,dh){
  manAz=norm360(manAz+da)
  manAlt=Math.max(-20,Math.min(90,manAlt+dh))
  dirty=1
}
function ang(x,y){ return Math.atan2(x-CX,-(y-CY))*R2D }
function drag(x0,y0,x1,y1){
  if(mode===0){turn(-(x1-x0)*DRAG_K,(y1-y0)*DRAG_K);return}
  // MAPは中心のまわりに回す。中心の近くは角度が暴れるので左右の動きで回す
  const r0=Math.abs(x0-CX)+Math.abs(y0-CY), r1=Math.abs(x1-CX)+Math.abs(y1-CY)
  if(r0<50||r1<50){turn(-(x1-x0)*DRAG_K,0);return}
  let da=ang(x1,y1)-ang(x0,y0)
  da=((da+540)%360)-180
  turn(-MAPSPIN*da/curZoom,0)
}
function tap(x,y){
  const k=mode?1.5:1
  if(x<160)turn(-TAP_AZ*k,0)
  else if(x>320)turn(TAP_AZ*k,0)
  else if(mode===0&&y<200)turn(0,TAP_ALT)
  else if(mode===0&&y>280)turn(0,-TAP_ALT)
}
function onDown(i){ if(!touch)return; lastTouch=Date.now(); tDown=[i.x,i.y]; tLast=[i.x,i.y]; tMoved=false }
function onMove(i){
  if(!touch||!tDown)return
  lastTouch=Date.now()
  if(!tMoved&&Math.abs(i.x-tDown[0])+Math.abs(i.y-tDown[1])<TAPPX)return
  tMoved=true
  drag(tLast[0],tLast[1],i.x,i.y); tLast=[i.x,i.y]
}
function onUp(i){
  if(!touch||!tDown)return
  lastTouch=Date.now()
  if(!tMoved&&Math.abs(i.x-tDown[0])+Math.abs(i.y-tDown[1])<TAPPX)tap(i.x,i.y)
  else drag(tLast[0],tLast[1],i.x,i.y)
  tDown=null; save()
}
// 画面のタッチが届かない場合の予備。スワイプ1回で一定量まわす
function onSwipe(e){
  if(!touch)return false
  if(Date.now()-lastTouch<700)return true
  if(e===GESTURE_LEFT)turn(SWIPE_AZ,0)
  else if(e===GESTURE_RIGHT)turn(-SWIPE_AZ,0)
  else if(e===GESTURE_UP&&mode===0)turn(0,-TAP_ALT)
  else if(e===GESTURE_DOWN&&mode===0)turn(0,TAP_ALT)
  save()
  return true
}
function toggleTouch(){
  touch=!touch
  if(touch){manAz=norm360(azF+decl()); manAlt=ALT0; dirty=0}
  tDown=null; save(); setBtn()
  try{redraw()}catch(e){showErr('DRAW '+e)}
}

Page({
  build(){
    try{setWakeUpRelaunch({relaunch:true})}catch(e){}
    try{setPageBrightTime({brightTime:600000})}catch(e){}
    try{pauseDropWristScreenOff({duration:0})}catch(e){}
    try{pausePalmScreenOff({duration:0})}catch(e){}
    const st=getState()
    if(st.mode!=null)mode=st.mode
    if(st.touch!=null)touch=st.touch
    if(st.manAz!=null)manAz=st.manAz
    if(st.manAlt!=null)manAlt=st.manAlt
    if(st.simT!==undefined)simT=st.simT
    if(st.lat!=null){lat=st.lat; lon=st.lon}
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
      perfTxt=createWidget(widget.TEXT,{x:20,y:376,w:440,h:34,text:'',
        text_size:22,color:0xffe066,align_h:align.CENTER_H,
        align_v:align.CENTER_V,text_style:text_style.NONE})
      perfTxt.setProperty(prop.VISIBLE,PERF?true:false)
      errTxt=createWidget(widget.TEXT,{x:20,y:180,w:440,h:160,text:'',
        text_size:20,color:0xff5566,align_h:align.LEFT,align_v:align.TOP,
        text_style:text_style.WRAP})
      errTxt.setProperty(prop.VISIBLE,false)
    }catch(e){showErr('UI '+e);return}

    // TOUCHのときだけ出す、透明なタッチ受け(ボタンより下に置く)
    try{
      touchPad=createWidget(widget.TEXT,{x:0,y:0,w:W,h:H,text:''})
      touchPad.addEventListener(event.CLICK_DOWN,onDown)
      touchPad.addEventListener(event.MOVE,onMove)
      touchPad.addEventListener(event.CLICK_UP,onUp)
    }catch(e){touchPad=null}

    try{
      modeBtn=mkBtn(B_MODE,'MAP180',18,C_DIR,()=>{mode=(mode+1)%4; save(); setBtn(); redraw()})
      touchBtn=mkBtn(B_TOUCH,'SENSOR',18,C_DIR,toggleTouch)
      listBtn=mkBtn(B_LIST,'LIST',22,C_DIR,()=>{save(); try{push({url:'page/list'})}catch(e){}})
      clockBtn=mkBtn(B_CLOCK,'',18,C_CLK,toggleNight)
      mkBtn(B_BACK,'-1h',18,C_DIR,()=>shiftH(-1),()=>shiftH(-24))
      mkBtn(B_FWD,'+1h',18,C_DIR,()=>shiftH(1),()=>shiftH(24))
    }catch(e){showErr('BTN '+e)}
    setBtn()
    try{onGesture({callback:onSwipe})}catch(e){}

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
        saveState({lat:lat,lon:lon})
        CA=null; locked=false; geo.stop&&geo.stop()
      })
    }catch(e){}

    clock()
    try{clkT=setInterval(clock,1000)}catch(e){}
    draw(azF,[gF.x,gF.y,gF.z],true)
    lastDraw=Date.now()
    try{timer=setInterval(tick,TICK)}catch(e){showErr('TIMER '+e)}
  },
  onDestroy(){
    if(timer){clearInterval(timer);timer=null}
    if(clkT){clearInterval(clkT);clkT=null}
    try{offGesture()}catch(e){}
    compass&&compass.stop&&compass.stop()
    accel&&accel.stop&&accel.stop()
    geo&&geo.stop&&geo.stop()
    save()
  }
})
