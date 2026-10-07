// ページのあいだで共有する状態（アプリを閉じると消える）
// mode, touch, manAz, manAlt: 星図の表示  simT: 時間移動中の時刻(ms, nullなら今)  lat, lon: 現在地
const LOCAL={}
function store(){
  try{
    const a=getApp()
    if(a){ if(!a.globalData)a.globalData={}; if(!a.globalData.astro)a.globalData.astro={}; return a.globalData.astro }
  }catch(e){}
  return LOCAL
}
export function getState(){ return store() }
export function saveState(o){ const s=store(); for(const k in o)s[k]=o[k] }
