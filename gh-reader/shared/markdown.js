// Markdown -> 表示ブロック (Terminal/md_reader_server.py の parse_markdown を移植)
const INLINE = [
  [/!\[[^\]]*\]\([^)]*\)/g, ''],
  [/!\[\[[^\]]*\]\]/g, ''],
  [/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2'],
  [/\[\[([^\]]+)\]\]/g, '$1'],
  [/\[([^\]]+)\]\([^)]*\)/g, '$1'],
  [/\*\*(.+?)\*\*/g, '$1'],
  [/__(.+?)__/g, '$1'],
  [/\*(.+?)\*/g, '$1'],
  [/`([^`]+)`/g, '$1'],
  [/<[^>]+>/g, '']
]

function clean(text) {
  let t = text
  for (const [re, rep] of INLINE) t = t.replace(re, rep)
  return t.trim()
}

export function parseMarkdown(raw, isMarkdown = true) {
  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []

  if (!isMarkdown) {
    // md 以外はそのままコード表示
    let buf = []
    const flushCode = () => {
      if (buf.length) blocks.push({ t: 'code', x: buf.join('\n') })
      buf = []
    }
    for (const l of lines) {
      buf.push(l)
      if (buf.length >= 20) flushCode()
    }
    flushCode()
    return blocks
  }

  let i = 0
  // YAML frontmatter を読み飛ばす
  if (lines[0] && lines[0].trim() === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) i = end + 1
  }

  let para = []
  const flush = () => {
    if (para.length) {
      const x = clean(para.join(' '))
      if (x) blocks.push({ t: 'p', x })
    }
    para = []
  }

  for (; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, '    ')
    const s = line.trim()

    if (/^(```|~~~)/.test(s)) {
      flush()
      const fence = s.slice(0, 3)
      const code = []
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence); i++) {
        code.push(lines[i])
      }
      if (code.length) blocks.push({ t: 'code', x: code.join('\n') })
      continue
    }
    if (!s) {
      flush()
      continue
    }
    let m = s.match(/^(#{1,6})\s+(.*)/)
    if (m) {
      flush()
      blocks.push({ t: 'h' + Math.min(m[1].length, 3), x: clean(m[2]) })
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) {
      flush()
      blocks.push({ t: 'hr', x: '' })
      continue
    }
    const lv = Math.min(Math.floor((line.length - line.trimStart().length) / 2), 3)
    m = s.match(/^[-*+]\s+(\[[ xX]\]\s+)?(.*)/)
    if (m) {
      flush()
      const box = m[1] ? (/x/i.test(m[1]) ? '☑ ' : '☐ ') : ''
      blocks.push({ t: 'li', l: lv, x: box + clean(m[2]) })
      continue
    }
    m = s.match(/^(\d+)[.)]\s+(.*)/)
    if (m) {
      flush()
      blocks.push({ t: 'li', l: lv, n: m[1], x: clean(m[2]) })
      continue
    }
    m = s.match(/^>\s?(.*)/)
    if (m) {
      flush()
      const x = clean(m[1].replace(/^\[![^\]]+\]\s*/, ''))
      if (x) blocks.push({ t: 'q', x })
      continue
    }
    if (/^\|.*\|$/.test(s)) {
      flush()
      if (/^\|[\s:|-]+\|$/.test(s)) continue // 表の区切り行
      const cells = s.slice(1, -1).split('|').map((c) => clean(c)).filter(Boolean)
      blocks.push({ t: 'p', x: cells.join(' / ') })
      continue
    }
    para.push(s)
  }
  flush()
  return blocks
}

// ブロック列を BLE で送りやすいサイズに分割
export function paginate(blocks, maxChars = 1800) {
  const pages = []
  let cur = []
  let size = 0
  for (const b of blocks) {
    let x = b.x
    // 巨大ブロックは分割
    while (x.length > maxChars) {
      if (cur.length) {
        pages.push(cur)
        cur = []
        size = 0
      }
      pages.push([{ ...b, x: x.slice(0, maxChars) }])
      x = x.slice(maxChars)
    }
    if (!x) continue
    const nb = { ...b, x }
    if (size + x.length > maxChars && cur.length) {
      pages.push(cur)
      cur = []
      size = 0
    }
    cur.push(nb)
    size += x.length + 10
  }
  if (cur.length) pages.push(cur)
  return pages.length ? pages : [[{ t: 'p', x: '(空のファイル)' }]]
}
