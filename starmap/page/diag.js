import { createWidget, widget, align, text_style, prop } from '@zos/ui'
import { Compass, Accelerometer } from '@zos/sensor'
import { setPageBrightTime, pauseDropWristScreenOff, pausePalmScreenOff } from '@zos/display'

const R2D=180/Math.PI
let t1,t2,timer,compass,accel
let raw=-1,g={x:0,y:0,z:0}
let aPos=-1,aNeg=-1,last=''

Page({
  build(){
    try{setPageBrightTime({brightTime:600000})}catch(e){}
    try{pauseDropWristScreenOff({duration:0})}catch(e){}
    try{pausePalmScreenOff({duration:0})}catch(e){}
    createWidget(widget.FILL_RECT,{x:0,y:0,w:480,h:480,color:0x000000})
    t1=createWidget(widget.TEXT,{x:20,y:90,w:440,h:150,text:'',text_size:30,
      color:0x00ff88,align_h:align.CENTER_H,align_v:align.TOP,
      text_style:text_style.WRAP})
    t2=createWidget(widget.TEXT,{x:20,y:270,w:440,h:150,text:'',text_size:34,
      color:0xffe066,align_h:align.CENTER_H,align_v:align.TOP,
      text_style:text_style.WRAP})

    compass=new Compass()
    compass.start&&compass.start()
    compass.onChange(()=>{const a=compass.getDirectionAngle()
      if(typeof a==='number'){raw=a
        if(g.z>0.10)aPos=a
        if(g.z<-0.10)aNeg=a}})

    accel=new Accelerometer()
    accel.start&&accel.start()
    accel.onChange(()=>{const c=accel.getCurrent()
      if(!c)return
      const n=Math.sqrt(c.x*c.x+c.y*c.y+c.z*c.z)||1
      g.x=c.x/n; g.y=c.y/n; g.z=c.z/n})

    const show=()=>{
      const va=Math.asin(Math.max(-1,Math.min(1,-g.z)))*R2D
      let d=(aPos<0||aNeg<0)?-1:Math.abs(aPos-aNeg)
      if(d>180)d=360-d
      const s='raw '+Math.round(raw)+'\n'
        +'gz '+g.z.toFixed(2)+'   valt '+Math.round(va)+'\n'
        +'gx '+g.x.toFixed(2)+'  gy '+g.y.toFixed(2)
      const u='A+ '+(aPos<0?'--':Math.round(aPos))
        +'\nA- '+(aNeg<0?'--':Math.round(aNeg))
        +'\ndiff '+(d<0?'--':Math.round(d))
      if(s+u!==last){last=s+u
        t1.setProperty(prop.MORE,{x:20,y:90,w:440,h:150,text:s,text_size:30,
          color:0x00ff88,align_h:align.CENTER_H})
        t2.setProperty(prop.MORE,{x:20,y:270,w:440,h:150,text:u,text_size:34,
          color:0xffe066,align_h:align.CENTER_H})}
    }
    show()
    timer=setInterval(show,300)
  },
  onDestroy(){
    if(timer){clearInterval(timer);timer=null}
    compass&&compass.stop&&compass.stop()
    accel&&accel.stop&&accel.stop()
  }
})
