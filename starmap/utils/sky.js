const D2R=Math.PI/180
export function resetFrame(){}

export function equToDevice(lst, latDeg, azDeg, g){
  const gl=Math.sqrt(g.x*g.x+g.y*g.y+g.z*g.z)||1
  const u=[g.x/gl,g.y/gl,g.z/gl]          // 天頂（デバイス座標）

  // 12時方向と3時方向の水平成分を、両方まとめて使う
  const y=[-u[1]*u[0], 1-u[1]*u[1], -u[1]*u[2]]
  const x=[1-u[0]*u[0], -u[0]*u[1], -u[0]*u[2]]
  const wy=Math.sqrt(y[0]*y[0]+y[1]*y[1]+y[2]*y[2])
  const wx=Math.sqrt(x[0]*x[0]+x[1]*x[1]+x[2]*x[2])

  // 重み付き合成。片方が潰れても他方が生き、途中で不連続にならない
  const a=azDeg*D2R
  const ca=Math.cos(a), sa=Math.sin(a)
  let n=[0,0,0]
  if(wy>1e-6){
    const ty=[y[0]/wy,y[1]/wy,y[2]/wy]
    const sy=[ty[1]*u[2]-ty[2]*u[1], ty[2]*u[0]-ty[0]*u[2], ty[0]*u[1]-ty[1]*u[0]]
    const w=wy*wy
    for(let i=0;i<3;i++) n[i]+=w*(ty[i]*ca-sy[i]*sa)
  }
  if(wx>1e-6){
    const tx=[x[0]/wx,x[1]/wx,x[2]/wx]
    const sx=[tx[1]*u[2]-tx[2]*u[1], tx[2]*u[0]-tx[0]*u[2], tx[0]*u[1]-tx[1]*u[0]]
    // 3時方向は12時方向から-90度ずれているので、その分を戻す
    const b=a-90*D2R
    const cb=Math.cos(b), sb=Math.sin(b)
    const w=wx*wx
    for(let i=0;i<3;i++) n[i]+=w*(tx[i]*cb-sx[i]*sb)
  }
  const d=n[0]*u[0]+n[1]*u[1]+n[2]*u[2]
  n=[n[0]-d*u[0], n[1]-d*u[1], n[2]-d*u[2]]
  const nl=Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2])||1
  n=[n[0]/nl,n[1]/nl,n[2]/nl]
  const e=[n[1]*u[2]-n[2]*u[1], n[2]*u[0]-n[0]*u[2], n[0]*u[1]-n[1]*u[0]]

  const cl=Math.cos(lst*D2R), sl=Math.sin(lst*D2R)
  const cp=Math.cos(latDeg*D2R), sp=Math.sin(latDeg*D2R)
  const E=[-sl,cl,0], N=[-sp*cl,-sp*sl,cp], U=[cp*cl,cp*sl,sp]
  const row=(A,B,C)=>[A*E[0]+B*N[0]+C*U[0], A*E[1]+B*N[1]+C*U[1], A*E[2]+B*N[2]+C*U[2]]
  const r0=row(e[0],n[0],u[0]), r1=row(e[1],n[1],u[1]), r2=row(e[2],n[2],u[2])
  return {m:[r0[0],r0[1],r0[2], r1[0],r1[1],r1[2], r2[0],r2[1],r2[2]],
          u:U, hb:{e:e,n:n,u:u}}
}
