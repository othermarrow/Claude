import { createWidget, widget, align, text_style, prop } from '@zos/ui'
import { Geolocation } from '@zos/sensor'
import { setPageBrightTime } from '@zos/display'
import { setScrollMode } from '@zos/page'
import { dayNumber, sunPos, moonPos, planetPos, lstDeg, eqVec, PLANETS } from '../utils/astro'
import { STARS, CONS } from '../utils/skydata'
import { OUTER, outerVec } from '../utils/outer'
import { drawGlyph } from '../utils/glyph'

const D2R=Math.PI/180,R2D=180/Math.PI
const EPS=23.4393*D2R
const PMARK=1
const ZMARK=1
const R16=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
const ZKEYS=['Ari','Tau','Gem','Cnc','Leo','Vir','Lib','Sco','Oph','Sgr','Cap','Aqr','Psc']
const SCON={Sirius:'Canis Major',Canopus:'Carina','Rigil Kentaurus':'Centaurus',
 Arcturus:'Bootes',Vega:'Lyra',Capella:'Auriga',Rigel:'Orion',Procyon:'Canis Minor',
 Achernar:'Eridanus',Betelgeuse:'Orion',Hadar:'Centaurus',Altair:'Aquila',
 Acrux:'Crux',Aldebaran:'Taurus',Antares:'Scorpius',Spica:'Virgo',
 Pollux:'Gemini',Fomalhaut:'Piscis Austrinus',Deneb:'Cygnus',Mimosa:'Crux',
 Regulus:'Leo'}
const ZB=[[28.7,'Pisces'],[53.5,'Aries'],[90.4,'Taurus'],[118.0,'Gemini'],
 [138.0,'Cancer'],[174.0,'Leo'],[217.8,'Virgo'],[241.1,'Libra'],
 [247.7,'Scorpius'],[266.6,'Ophiuchus'],[299.7,'Sagittarius'],
 [327.6,'Capricornus'],[351.6,'Aquarius'],[361,'Pisces']]
const PHASE=['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous',
 'Full Moon','Waning Gibbous','Last Quarter','Waning Crescent']
function zod(L){L=((L%360)+360)%360
  for(let i=0;i<ZB.length;i++) if(L<ZB[i][0])return ZB[i][1]
  return 'Pisces'}
const ZC=[]
for(let i=0;i<CONS.length;i++) if(ZKEYS.indexOf(CONS[i].a)>=0) ZC.push(CONS[i])
const ALLP=PLANETS.concat(OUTER)

const X=34,WROW=412,RH=40,RH2=26,SH=50,LW=250,RSZ=17
const C_HI=0xffffff,C_LO=0x515c68,C_LB=0x8fa3b8,C_SEC=0x00cfe0
const C_SUN=0xffcc33,C_MOON=0xdde6f0,C_PL=0xffd27f,C_CN=0x7fb4dc,C_SUB=0x6d7f91

let lat=34.685,lon=135.805,geo=null
let rows=[],clkT=null,calcT=null,gcan=null,PY=0,PH=0,zcan=null,ZY=0,ZH=0
let IX={}

function p2(n){return (n<10?'0':'')+n}
function hm(t){if(t==null)return '--:--';const d=new Date(t);return p2(d.getHours())+':'+p2(d.getMinutes())}
function aa(v,lst){
  const cl=Math.cos(lst*D2R),sl=Math.sin(lst*D2R)
  const cp=Math.cos(lat*D2R),sp=Math.sin(lat*D2R)
  const e=-sl*v[0]+cl*v[1]
  const n=-sp*cl*v[0]-sp*sl*v[1]+cp*v[2]
  let u=cp*cl*v[0]+cp*sl*v[1]+sp*v[2]
  if(u>1)u=1; if(u<-1)u=-1
  let az=Math.atan2(e,n)*R2D; if(az<0)az+=360
  return {alt:Math.asin(u)*R2D, az:az}
}
function eclLon(v){
  const y=v[1]*Math.cos(EPS)+v[2]*Math.sin(EPS)
  let L=Math.atan2(y,v[0])*R2D
  return L<0?L+360:L
}
function vecOf(kind,d,sun){
  if(kind===0)return eqVec(sun.ra,sun.dec)
  const m=moonPos(d,sun); return eqVec(m.ra,m.dec)
}
function events(kind,h0){
  const t0=new Date(); t0.setHours(0,0,0,0)
  const base=t0.getTime(), dt=600000, N=144
  const A=[]
  for(let i=0;i<=N;i++){
    const dd=dayNumber(new Date(base+i*dt))
    const su=sunPos(dd)
    A.push(aa(vecOf(kind,dd,su),lstDeg(dd,su.L,lon)).alt)
  }
  let rise=null,set=null,mi=0
  for(let i=1;i<=N;i++){
    if(A[i]>A[mi])mi=i
    const a=A[i]-h0,b=A[i-1]-h0
    if(b<0&&a>=0&&rise==null)rise=base+(i-1)*dt+dt*(-b)/(a-b)
    if(b>=0&&a<0&&set==null)set=base+(i-1)*dt+dt*(b)/(b-a)
  }
  let tr=base+mi*dt
  if(mi>0&&mi<N){
    const y1=A[mi-1],y2=A[mi],y3=A[mi+1], den=y1-2*y2+y3
    if(Math.abs(den)>1e-9)tr+=dt*0.5*(y1-y3)/den
  }
  return {rise:rise,set:set,transit:tr}
}
function mk(y,h,size,color,alignH,x,w){
  const t=createWidget(widget.TEXT,{x:x,y:y,w:w,h:h,text:'',
    text_size:size,color:color,align_h:alignH,align_v:align.CENTER_V,
    text_style:text_style.NONE})
  rows.push({w:t,x:x,y:y,h:h,s:size,a:alignH,ww:w})
  return rows.length-1
}
function put(i,txt,color){
  const r=rows[i]
  r.w.setProperty(prop.MORE,{x:r.x,y:r.y,w:r.ww,h:r.h,text:txt,
    text_size:r.s,color:color,align_h:r.a})
}

function layout(){
  let y=24
  IX.date=mk(y,32,22,C_LB,align.CENTER_H,20,440); y+=38
  IX.pos=mk(y,26,16,C_LO,align.CENTER_H,20,440); y+=44

  IX.sunH=mk(y,SH,21,C_SEC,align.CENTER_H,20,440); y+=SH
  IX.sunA=mk(y,RH,20,C_SUN,align.CENTER_H,20,440); y+=RH
  IX.sunT=mk(y,RH,18,C_LB,align.CENTER_H,20,440); y+=RH+16

  IX.moonH=mk(y,SH,21,C_SEC,align.CENTER_H,20,440); y+=SH
  IX.moonP=mk(y,RH,19,C_MOON,align.CENTER_H,20,440); y+=RH
  IX.moonA=mk(y,RH,20,C_MOON,align.CENTER_H,20,440); y+=RH
  IX.moonT=mk(y,RH,18,C_LB,align.CENTER_H,20,440); y+=RH+16

  IX.plH=mk(y,SH,21,C_SEC,align.CENTER_H,20,440); y+=SH
  PY=y; PH=ALLP.length*RH
  if(PMARK){try{gcan=createWidget(widget.CANVAS,{x:0,y:PY,w:480,h:PH})}catch(e){gcan=null}}
  IX.pl=[]
  for(let i=0;i<ALLP.length;i++){
    const a=mk(y,RH,RSZ,C_PL,align.LEFT,X+34,LW)
    const b=mk(y,RH,RSZ,C_PL,align.RIGHT,X,WROW)
    IX.pl.push([a,b]); y+=RH
  }
  y+=16

  IX.zH=mk(y,SH,21,C_SEC,align.CENTER_H,20,440); y+=SH
  ZY=y; ZH=ZC.length*RH
  if(ZMARK){try{zcan=createWidget(widget.CANVAS,{x:0,y:ZY,w:480,h:ZH})}catch(e){zcan=null}}
  IX.z=[]
  for(let i=0;i<ZC.length;i++){
    const a=mk(y,RH,RSZ,C_CN,align.LEFT,X+34,LW)
    const b=mk(y,RH,RSZ,C_CN,align.RIGHT,X,WROW)
    IX.z.push([a,b]); y+=RH
  }
  y+=16

  IX.stH=mk(y,SH,21,C_SEC,align.CENTER_H,20,440); y+=SH
  IX.st=[]
  for(let i=0;i<STARS.length;i++){
    const a=mk(y,RH,RSZ,C_HI,align.LEFT,X,LW)
    const b=mk(y,RH,RSZ,C_HI,align.RIGHT,X,WROW)
    const c=mk(y+RH-6,RH2,15,C_SUB,align.LEFT,X+16,LW)
    IX.st.push([a,b,c]); y+=RH+RH2
  }
  y+=40
  try{setScrollMode({mode:'free',options:{height:y}})}catch(e){}
}

function clockOnly(){
  const n=new Date()
  put(IX.date, n.getFullYear()+'/'+p2(n.getMonth()+1)+'/'+p2(n.getDate())
      +'  '+p2(n.getHours())+':'+p2(n.getMinutes())+':'+p2(n.getSeconds()), C_LB)
}

function render(){
  const now=new Date(), d=dayNumber(now)
  const sun=sunPos(d), lst=lstDeg(d,sun.L,lon)
  const dir=a=>R16[Math.round(a/22.5)%16]+' '+Math.round(a)+'\u00B0'
  const sgn=v=>(v>=0?'+':'')+v.toFixed(1)+'\u00B0'

  clockOnly()
  put(IX.pos, lat.toFixed(3)+'\u00B0N  '+lon.toFixed(3)+'\u00B0E', C_LO)

  const sv=eqVec(sun.ra,sun.dec), sq=aa(sv,lst), se=events(0,-0.833)
  put(IX.sunH,'\u2609  SUN',C_SEC)
  put(IX.sunA,dir(sq.az)+'   '+sgn(sq.alt)+'   '+zod(eclLon(sv)),sq.alt>=0?C_SUN:C_LO)
  put(IX.sunT,'Rise '+hm(se.rise)+'   Transit '+hm(se.transit)+'   Set '+hm(se.set),C_LB)

  const mo=moonPos(d,sun), mv=eqVec(mo.ra,mo.dec), mq=aa(mv,lst), me=events(1,0.125)
  let el=eclLon(mv)-eclLon(sv); el=((el%360)+360)%360
  put(IX.moonH,'\u263D  MOON',C_SEC)
  put(IX.moonP,PHASE[Math.floor(((el+22.5)%360)/45)]+'   Age '+(el/360*29.5306).toFixed(1)
      +'   '+Math.round((1-Math.cos(el*D2R))*50)+'%',C_MOON)
  put(IX.moonA,dir(mq.az)+'   '+sgn(mq.alt)+'   '+zod(eclLon(mv)),mq.alt>=0?C_MOON:C_LO)
  put(IX.moonT,'Rise '+hm(me.rise)+'   Transit '+hm(me.transit)+'   Set '+hm(me.set),C_LB)

  put(IX.plH,'\u25C9  PLANETS',C_SEC)
  const pl=[]
  for(let i=0;i<PLANETS.length;i++){
    const q=planetPos(PLANETS[i],d,sun), v=eqVec(q.ra,q.dec), r=aa(v,lst)
    pl.push({n:PLANETS[i],alt:r.alt,az:r.az,c:zod(eclLon(v))})
  }
  for(let i=0;i<OUTER.length;i++){
    const v=outerVec(OUTER[i],d), r=aa(v,lst)
    pl.push({n:OUTER[i],alt:r.alt,az:r.az,c:zod(eclLon(v))})
  }
  pl.sort((a,b)=>b.alt-a.alt)
  if(gcan){try{gcan.clear({x:0,y:0,w:480,h:PH})}catch(e){}}
  for(let i=0;i<pl.length;i++){
    const c=pl[i].alt>=0?C_PL:C_LO
    if(gcan)drawGlyph(gcan,pl[i].n,X+14,i*RH+(RH>>1),8,c)
    put(IX.pl[i][0],pl[i].n+'   '+pl[i].c,c)
    put(IX.pl[i][1],dir(pl[i].az)+'   '+sgn(pl[i].alt),c)
  }

  put(IX.zH,'\u264C  ZODIAC',C_SEC)
  const zz=[]
  for(let i=0;i<ZC.length;i++){
    const r=aa(ZC[i].c,lst)
    zz.push({a:ZC[i].a,n:ZC[i].n,alt:r.alt,az:r.az})
  }
  zz.sort((a,b)=>b.alt-a.alt)
  if(zcan){try{zcan.clear({x:0,y:0,w:480,h:ZH})}catch(e){}}
  for(let i=0;i<zz.length;i++){
    const c=zz[i].alt>=0?C_CN:C_LO
    if(zcan)drawGlyph(zcan,zz[i].a,X+14,i*RH+(RH>>1),8,c)
    put(IX.z[i][0],zz[i].n,c)
    put(IX.z[i][1],dir(zz[i].az)+'   '+sgn(zz[i].alt),c)
  }

  put(IX.stH,'\u2605  1ST MAGNITUDE',C_SEC)
  const st=[]
  for(let i=0;i<STARS.length;i++){
    const s=STARS[i], r=aa([s[1],s[2],s[3]],lst)
    st.push({n:s[0],alt:r.alt,az:r.az})
  }
  st.sort((a,b)=>b.alt-a.alt)
  for(let i=0;i<st.length;i++){
    const c=st[i].alt>=0?C_HI:C_LO
    put(IX.st[i][0],st[i].n,c)
    put(IX.st[i][1],dir(st[i].az)+'   '+sgn(st[i].alt),c)
    put(IX.st[i][2],SCON[st[i].n]||'',st[i].alt>=0?C_SUB:C_LO)
  }
}

Page({
  build(){
    try{setPageBrightTime({brightTime:600000})}catch(e){}
    createWidget(widget.FILL_RECT,{x:0,y:0,w:480,h:480,color:0x000000})
    layout()
    render()
    try{clkT=setInterval(clockOnly,1000)}catch(e){}
    try{calcT=setInterval(render,3600000)}catch(e){}
    try{
      geo=new Geolocation()
      geo.start&&geo.start()
      geo.onChange(()=>{
        if(geo.getStatus()!=='A')return
        lat=geo.getLatitude({format:'DD'}); lon=geo.getLongitude({format:'DD'})
        geo.stop&&geo.stop(); render()
      })
    }catch(e){}
  },
  onDestroy(){
    if(clkT){clearInterval(clkT);clkT=null}
    if(calcT){clearInterval(calcT);calcT=null}
    geo&&geo.stop&&geo.stop()
  }
})
