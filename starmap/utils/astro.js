const D2R = Math.PI / 180, R2D = 180 / Math.PI
const sin = a => Math.sin(a * D2R)
const cos = a => Math.cos(a * D2R)
const rev = a => ((a % 360) + 360) % 360

export function dayNumber(dt) {
  const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate()
  const dn = 367 * y - Math.floor(7 * (y + Math.floor((m + 9) / 12)) / 4)
           + Math.floor(275 * m / 9) + d - 730530
  return dn + (dt.getUTCHours() + dt.getUTCMinutes() / 60 + dt.getUTCSeconds() / 3600) / 24
}

function kepler(M, e, iter) {
  let E = M + R2D * e * sin(M) * (1 + e * cos(M))
  for (let k = 0; k < iter; k++) E -= (E - R2D * e * sin(E) - M) / (1 - e * cos(E))
  return E
}
function toEq(x, y, z, ecl) {
  const ye = y * cos(ecl) - z * sin(ecl), ze = y * sin(ecl) + z * cos(ecl)
  return { ra: rev(Math.atan2(ye, x) * R2D),
           dec: Math.atan2(ze, Math.sqrt(x * x + ye * ye)) * R2D }
}

export function sunPos(d) {
  const w = 282.9404 + 4.70935e-5 * d
  const e = 0.016709 - 1.151e-9 * d
  const M = rev(356.0470 + 0.9856002585 * d)
  const ecl = 23.4393 - 3.563e-7 * d
  const E = kepler(M, e, 0)
  const xv = cos(E) - e, yv = Math.sqrt(1 - e * e) * sin(E)
  const r = Math.sqrt(xv * xv + yv * yv)
  const lon = rev(Math.atan2(yv, xv) * R2D + w)
  const xs = r * cos(lon), ys = r * sin(lon)
  const q = toEq(xs, ys, 0, ecl)
  return { ra: q.ra, dec: q.dec, xs, ys, L: rev(M + w), ecl }
}

export function lstDeg(d, sunL, lonEast) {
  return rev(rev(sunL + 180) + (d - Math.floor(d)) * 360 + lonEast)
}

const P = {
  Mercury: [[48.3313,3.24587e-5],[7.0047,5.0e-8],[29.1241,1.01444e-5],
            [0.387098,0],[0.205635,5.59e-10],[168.6562,4.0923344368]],
  Venus:   [[76.6799,2.46590e-5],[3.3946,2.75e-8],[54.8910,1.38374e-5],
            [0.723330,0],[0.006773,-1.302e-9],[48.0052,1.6021302244]],
  Mars:    [[49.5574,2.11081e-5],[1.8497,-1.78e-8],[286.5016,2.92961e-5],
            [1.523688,0],[0.093405,2.516e-9],[18.6021,0.5240207766]],
  Jupiter: [[100.4542,2.76854e-5],[1.3030,-1.557e-7],[273.8777,1.64505e-5],
            [5.20256,0],[0.048498,4.469e-9],[19.8950,0.0830853001]],
  Saturn:  [[113.6634,2.38980e-5],[2.4886,-1.081e-7],[339.3939,2.97661e-5],
            [9.55475,0],[0.055546,-9.499e-9],[316.9670,0.0334442282]]
}
export const PLANETS = ["Mercury","Venus","Mars","Jupiter","Saturn"]

export function planetPos(name, d, sun) {
  const q = P[name]
  const N = rev(q[0][0] + q[0][1] * d), i = q[1][0] + q[1][1] * d
  const w = rev(q[2][0] + q[2][1] * d), a = q[3][0]
  const e = q[4][0] + q[4][1] * d, M = rev(q[5][0] + q[5][1] * d)
  const E = kepler(M, e, e > 0.05 ? 3 : 0)
  const xv = a * (cos(E) - e), yv = a * Math.sqrt(1 - e * e) * sin(E)
  const r = Math.sqrt(xv * xv + yv * yv)
  const vw = Math.atan2(yv, xv) * R2D + w
  const xh = r * (cos(N) * cos(vw) - sin(N) * sin(vw) * cos(i))
  const yh = r * (sin(N) * cos(vw) + cos(N) * sin(vw) * cos(i))
  const zh = r * sin(vw) * sin(i)
  return toEq(xh + sun.xs, yh + sun.ys, zh, sun.ecl)
}

export function moonPos(d, sun) {
  const N = rev(125.1228 - 0.0529538083 * d), i = 5.1454
  const w = rev(318.0634 + 0.1643573223 * d), a = 60.2666, e = 0.054900
  const M = rev(115.3654 + 13.0649929509 * d)
  const E = kepler(M, e, 3)
  const xv = a * (cos(E) - e), yv = a * Math.sqrt(1 - e * e) * sin(E)
  const r = Math.sqrt(xv * xv + yv * yv)
  const vw = Math.atan2(yv, xv) * R2D + w
  const xh = r * (cos(N) * cos(vw) - sin(N) * sin(vw) * cos(i))
  const yh = r * (sin(N) * cos(vw) + cos(N) * sin(vw) * cos(i))
  const zh = r * sin(vw) * sin(i)
  let lon = rev(Math.atan2(yh, xh) * R2D)
  let lat = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) * R2D
  const Ms = rev(356.0470 + 0.9856002585 * d)
  const Ls = rev(Ms + 282.9404 + 4.70935e-5 * d)
  const Lm = rev(N + w + M), D = rev(Lm - Ls), F = rev(Lm - N)
  lon += -1.274*sin(M-2*D) + 0.658*sin(2*D) - 0.186*sin(Ms) - 0.059*sin(2*M-2*D)
       - 0.057*sin(M-2*D+Ms) + 0.053*sin(M+2*D) + 0.046*sin(2*D-Ms) + 0.041*sin(M-Ms)
       - 0.035*sin(D) - 0.031*sin(M+Ms) - 0.015*sin(2*F-2*D) + 0.011*sin(M-4*D)
  lat += -0.173*sin(F-2*D) - 0.055*sin(M-F-2*D) - 0.046*sin(M+F-2*D)
       + 0.033*sin(F+2*D) + 0.017*sin(2*M+F)
  return toEq(cos(lon)*cos(lat), sin(lon)*cos(lat), sin(lat), sun.ecl)
}

export function eqVec(ra, dec) {
  return [cos(dec)*cos(ra), cos(dec)*sin(ra), sin(dec)]
}
