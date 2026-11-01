import { BaseApp } from '@zeppos/zml/base-app'

// スマホ（Zepp アプリのサイドサービス）と話すために、zml の BaseApp を使う
App(BaseApp({ globalData: {}, onCreate() {}, onDestroy() {} }))
