const D2R=Math.PI/180
const EPS=23.4393*D2R
function rev(x){return x-Math.floor(x/360)*360}

const EL={
 Uranus:{N:[74.0005,1.3978e-5],i:[0.7733,1.9e-8],w:[96.6612,3.0565e-5],
         a:[19.18171,-1.55e-8],e:[0.047318,7.45e-9],M:[142.5905,0.011725806]},
 Neptune:{N:[131.7806,3.0173e-5],i:[1.7700,-2.55e-7],w:[272.8461,-6.027e-6],
          a:[30.05826,3.313e-8],e:[0.008606,2.15e-9],M:[260.2471,0.005995147]}
}
export const OUTER=['Uranus','Neptune']

function sunXY(d){
  const w=rev(282.9404+4.70935e-5*d)
  const e=0.016709-1.151e-9*d
  const M=rev(356.0470+0.9856002585*d)*D2R
  const E=M+e*Math.sin(M)*(1+e*Math.cos(M))
  const xv=Math.cos(E)-e, yv=Math.sqrt(1-e*e)*Math.sin(E)
  const r=Math.sqrt(xv*xv+yv*yv)
  const L=(Math.atan2(yv,xv)/D2R+w)*D2R
  return [r*Math.cos(L), r*Math.sin(L)]
}

export function outerVec(name,d){
  const p=EL[name]
  const N=rev(p.N[0]+p.N[1]*d)*D2R
  const i=(p.i[0]+p.i[1]*d)*D2R
  const w=rev(p.w[0]+p.w[1]*d)*D2R
  const a=p.a[0]+p.a[1]*d
  const e=p.e[0]+p.e[1]*d
  const M=rev(p.M[0]+p.M[1]*d)*D2R
  let E=M+e*Math.sin(M)*(1+e*Math.cos(M))
  for(let k=0;k<6;k++) E=E-(E-e*Math.sin(E)-M)/(1-e*Math.cos(E))
  const xv=a*(Math.cos(E)-e), yv=a*Math.sqrt(1-e*e)*Math.sin(E)
  const r=Math.sqrt(xv*xv+yv*yv), v=Math.atan2(yv,xv)
  const u=v+w
  const cu=Math.cos(u), su=Math.sin(u), cN=Math.cos(N), sN=Math.sin(N), ci=Math.cos(i)
  const xh=r*(cN*cu-sN*su*ci), yh=r*(sN*cu+cN*su*ci), zh=r*su*Math.sin(i)
  const s=sunXY(d)
  const xg=xh+s[0], yg=yh+s[1], zg=zh
  const xe=xg, ye=yg*Math.cos(EPS)-zg*Math.sin(EPS), ze=yg*Math.sin(EPS)+zg*Math.cos(EPS)
  const L=Math.sqrt(xe*xe+ye*ye+ze*ze)||1
  return [xe/L,ye/L,ze/L]
}
