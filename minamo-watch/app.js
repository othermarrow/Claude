import { BaseApp } from '@zeppos/zml/base-app'

// スマホ（Zepp アプリのサイドサービス）と話すために、zml の BaseApp を使う。
// 時計の予約（@zos/alarm）で起こされたときは、param に '59'（毎時の合図）か 'mono'（独り言）が届く
App(BaseApp({
  globalData: { launch: '' },
  onCreate(param) { this.globalData.launch = typeof param === 'string' ? param : '' },
  onDestroy() {}
}))
