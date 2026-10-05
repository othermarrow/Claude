// スマホの Zepp アプリ → GH Reader → 設定 で表示される画面
const FIELDS = [
  { key: 'owner', label: 'Owner (ユーザー名)', placeholder: 'othermarrow' },
  { key: 'repo', label: 'Repository', placeholder: 'Psychology' },
  { key: 'branch', label: 'Branch (空欄=デフォルト)', placeholder: 'main' },
  { key: 'offline', label: 'オフライン用フォルダ', placeholder: 'Abstract/report' }
]

AppSettingsPage({
  build(props) {
    const st = props.settingsStorage
    const rows = FIELDS.map((f) =>
      View({ style: { marginBottom: '14px' } }, [
        TextInput({
          label: f.label,
          placeholder: f.placeholder,
          value: st.getItem(f.key) || '',
          subStyle: { color: '#333', fontSize: '14px' },
          onChange: (val) => st.setItem(f.key, (val || '').trim())
        })
      ])
    )

    const hasToken = !!st.getItem('token')
    rows.push(
      View({ style: { marginBottom: '14px' } }, [
        TextInput({
          label: `Token ${hasToken ? '(設定済み・上書きで変更)' : '(非公開リポジトリ用)'}`,
          placeholder: 'github_pat_...',
          value: '',
          subStyle: { color: '#333', fontSize: '14px' },
          onChange: (val) => st.setItem('token', (val || '').trim())
        })
      ])
    )
    if (hasToken) {
      rows.push(
        Button({
          label: 'トークンを削除',
          style: { fontSize: '12px', borderRadius: '30px', background: '#D85E33', color: 'white' },
          onClick: () => st.setItem('token', '')
        })
      )
    }
    rows.push(
      Text(
        { paragraph: true, style: { fontSize: '12px', color: '#888', marginTop: '16px' } },
        'トークンは GitHub > Settings > Developer settings > Fine-grained tokens で、対象リポジトリのみ・Contents: Read-only で作成してください。作成日順の並べ替えにはトークンが必要です。'
      )
    )

    return View({ style: { padding: '12px 20px' } }, rows)
  }
})
