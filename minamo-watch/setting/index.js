// スマホの Zepp アプリ → ミナモ → 設定 で出る画面
AppSettingsPage({
  build(props) {
    const st = props.settingsStorage
    return View({ style: { padding: '12px 20px' } }, [
      Text(
        { paragraph: true, style: { fontSize: '14px', color: '#333', marginBottom: '14px' } },
        'スマホで、ミナモのサーバー（Termux の mo）が動いていると、時計の脈や押したボタンがスマホのミナモに届き、時計の返事をスマホの AI が考えます。動いていなければ、時計は自分だけで話します。'
      ),
      TextInput({
        label: 'ミナモのサーバー（ふつうは変えない）',
        placeholder: 'http://127.0.0.1:9090',
        value: st.getItem('url') || '',
        subStyle: { color: '#333', fontSize: '14px' },
        onChange: (val) => st.setItem('url', (val || '').trim())
      }),
      Text(
        { paragraph: true, style: { fontSize: '13px', color: '#666', marginTop: '18px' } },
        '状態：' + (st.getItem('status') || 'まだ、つないでいません（時計でミナモを開くと、つなぎます）')
      )
    ])
  }
})
