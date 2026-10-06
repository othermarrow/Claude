// translate.js — ゲームの英文を辞書で日本語にし、日本語の命令を英語の命令に直す。
// Termux 版（zork_ja.py）と同じ辞書（data/*.tsv）と同じ考え方で動く。
"use strict";

function readTsv(text) {
  const rows = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith("#") || !line.includes("\t")) continue;
    rows.push(line.split("\t"));
  }
  return rows;
}
const norm = s => s.split(/\s+/).filter(Boolean).join(" ");
const SENT_RE = /(?<=[.!?])\s+(?=[A-Z"(\[])|(?<=[.!?]")\s+/;

class Translator {
  constructor(data, cache) {
    this.names = new Map(readTsv(data.names).map(r => [norm(r[0]).toLowerCase(), r[1]]));
    this.msgs = new Map(readTsv(data.messages).map(r => [norm(r[0]), r[1]]));
    this.patterns = [];
    for (const r of readTsv(data.patterns)) {
      try { this.patterns.push([new RegExp(r[0]), r[1]]); } catch (e) { /* 壊れた行は使わない */ }
    }
    this.cache = cache || new Map();
  }

  // 物や部屋の名前を日本語に。わからなければ null
  name(s) {
    s = norm(s);
    if (/^-?\d+$/.test(s)) return s;
    if (this.names.has(s.toLowerCase())) return this.names.get(s.toLowerCase());
    const low = s.toLowerCase().replace(/^(a|an|the|some|your)\s+/, "");
    if (this.names.has(low)) return this.names.get(low);
    const parts = low.split(/,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+/).filter(Boolean);
    if (parts.length > 1) {
      const out = parts.map(p => this.name(p));
      if (out.every(Boolean)) return out.join("、");
    }
    return null;
  }

  // 一文を訳す。訳せなければ null
  sentence(s) {
    s = norm(s);
    if (!s) return "";
    if (this.msgs.has(s)) return this.msgs.get(s);
    if (this.cache.has(s)) return this.cache.get(s);
    // 「物の名前: 文」の形（全部取る・全部読む などの結果）を、名前と文に分けて訳す
    const pm = s.match(/^([^:]{1,60}): (.+)$/);
    if (pm && this.name(pm[1])) {
      const rest = this.sentence(pm[2]);
      if (rest !== null) return this.name(pm[1]) + "：" + rest;
    }
    for (const [rx, tmpl] of this.patterns) {
      const m = s.match(rx);
      if (!m) continue;
      let out = tmpl, ok = true;
      for (let i = 1; i < m.length; i++) {
        const g = m[i] || "";
        out = out.split(`{r${i}}`).join(g);
        if (out.includes(`{s${i}}`)) out = out.split(`{s${i}}`).join(this.name(g) ?? g);
        if (out.includes(`{${i}}`)) {
          const j = this.name(g);
          if (j === null) { ok = false; break; }
          out = out.split(`{${i}}`).join(j);
        }
      }
      if (ok) return out;
    }
    return null;
  }

  // 1行を [{ja, en}] の文の並びに。ja が null の文は未翻訳
  line(text) {
    const t = text.trim();
    if (this.msgs.has(norm(t))) return [{ ja: this.msgs.get(norm(t)), en: t }];
    if (this.names.has(t.toLowerCase())) return [{ ja: this.names.get(t.toLowerCase()), en: t }];
    return t.split(SENT_RE).map(s => ({ ja: this.sentence(s), en: s }));
  }

  // ゲームの出力を行ごとに訳す。[{ja, en, parts, indent}] を返す
  block(raw) {
    const lines = raw.replace(/\r/g, "").split("\n");
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length && lines[lines.length - 1].trimEnd().endsWith(">")) {
      lines[lines.length - 1] = lines[lines.length - 1].trimEnd().slice(0, -1).trimEnd();
      if (!lines[lines.length - 1].trim()) lines.pop();
    }
    return lines.map(ln => {
      if (!ln.trim()) return { blank: true };
      const indent = ln.length - ln.trimStart().length;
      if (indent) {
        const j = this.name(ln.trim()) || this.sentence(ln.trim());
        if (j !== null) return { indent, en: ln.trim(), parts: [{ ja: j, en: ln.trim() }] };
      }
      return { indent, en: ln.trim(), parts: this.line(ln) };
    });
  }

  // 未翻訳の文を集める
  pending(rows) {
    const set = new Set();
    for (const r of rows) for (const p of r.parts || []) if (p.ja === null && !this.cache.has(norm(p.en))) set.add(norm(p.en));
    return [...set];
  }

  // 行の日本語（未翻訳の文は英語のまま）
  jaOf(row) {
    const parts = row.parts.map(p => p.ja ?? this.cache.get(norm(p.en)) ?? null);
    const all = parts.every(x => x !== null);
    const seg = parts.map((x, i) => x ?? row.parts[i].en);
    return { text: seg.join(all ? "" : " "), complete: all };
  }

  glossaryFor(sentences) {
    const out = [];
    const low = sentences.join(" ").toLowerCase();
    for (const [en, ja] of this.names) if (en.length > 3 && low.includes(en)) out.push(`${en} = ${ja}`);
    return out;
  }
}

// ---- 日本語の命令 → 英語 ----
const SPECIAL = {
  "見る": "look", "みる": "look", "周りを見る": "look", "まわりを見る": "look",
  "見回す": "look", "見わたす": "look", "見渡す": "look", "あたりを見る": "look",
  "持ち物": "inventory", "もちもの": "inventory", "所持品": "inventory",
  "持ち物を見る": "inventory", "持ち物を確認": "inventory", "アイテム": "inventory",
  "待つ": "wait", "まつ": "wait", "待機": "wait",
  "得点": "score", "スコア": "score", "点数": "score",
  "セーブ": "save", "保存": "save", "保存する": "save",
  "ロード": "restore", "再開": "restore", "続きから": "restore",
  "やり直す": "restart", "リスタート": "restart", "最初から": "restart",
  "終了": "quit", "終わる": "quit", "やめる": "quit", "おわり": "quit",
  "はい": "yes", "うん": "yes", "いいえ": "no", "いや": "no",
  "詳しく": "verbose", "詳細": "verbose", "簡潔": "brief", "簡単に": "brief",
  "もう一度": "again", "もういちど": "again", "くり返す": "again", "繰り返す": "again",
  "祈る": "pray", "ジャンプ": "jump", "跳ぶ": "jump", "飛ぶ": "jump",
  "泳ぐ": "swim", "叫ぶ": "yell", "さけぶ": "yell", "こんにちは": "hello",
  "体調": "diagnose", "診断": "diagnose", "けが": "diagnose",
  "全部取る": "take all", "全部拾う": "take all", "全部置く": "drop all",
  "聞く": "listen", "においを嗅ぐ": "smell", "嗅ぐ": "smell",
  "登る": "up", "上る": "up", "降りる": "down", "下りる": "down",
  "入る": "in", "出る": "out", "外に出る": "out", "中に入る": "in",
};
const DIRS = {
  "北東": "northeast", "北西": "northwest", "南東": "southeast", "南西": "southwest",
  "北": "north", "南": "south", "東": "east", "西": "west",
  "上": "up", "下": "down", "中": "in", "外": "out",
};
const DIR_RE = /^(北東|北西|南東|南西|北|南|東|西|上|下|中|外)(?:の方)?(?:へ|に)?(?:行く|いく|進む|すすむ|向かう|移動する|移動|歩く)?$/;
const PARTICLE_RE = /(の中に|の中へ|の中から|の上に|の上へ|を|に|へ|で|から|と)/;
const I_TO_U = { "い": "う", "き": "く", "ぎ": "ぐ", "し": "す", "ち": "つ", "に": "ぬ", "び": "ぶ", "み": "む", "り": "る" };
const TE_RULES = [["して", ["す", "する"]], ["いて", ["く"]], ["いで", ["ぐ"]],
  ["って", ["る", "う", "つ", "く"]], ["んで", ["む", "ぶ", "ぬ"]], ["て", ["る"]]];

function* dictionaryForms(s) {
  yield s;
  if (s.endsWith("ます")) {
    const stem = s.slice(0, -2);
    yield stem + "る";
    if (stem && I_TO_U[stem.slice(-1)]) yield stem.slice(0, -1) + I_TO_U[stem.slice(-1)];
  }
  for (const [suf, reps] of TE_RULES) {
    if (s.endsWith(suf)) for (const r of reps) yield s.slice(0, -suf.length) + r;
  }
}

class CommandParser {
  constructor(data, tr) {
    this.verbs = [];
    for (const r of readTsv(data.verbs)) {
      for (const f of r[0].split(",").map(x => x.trim()).filter(Boolean)) {
        this.verbs.push([f, r[1] || "", r[2] || ""]);
      }
    }
    this.verbs.sort((a, b) => b[0].length - a[0].length);
    this.nouns = new Map();
    for (const r of readTsv(data.nouns)) {
      for (const f of r[0].split(",").map(x => x.trim()).filter(Boolean)) this.nouns.set(f, r[1]);
    }
    for (const [en, ja] of tr.names) if (!this.nouns.has(ja)) this.nouns.set(ja, en.split(" ").pop());
    this.nounKeys = [...this.nouns.keys()].sort((a, b) => b.length - a.length);
  }

  noun(s) {
    s = (s || "").trim().replace(/[「」]/g, "").replace(/^(その|この|あの)/, "").replace(/の$/, "");
    if (!s) return null;
    if (/^[A-Za-z0-9 '\-]+$/.test(s)) return s.toLowerCase();
    if (this.nouns.has(s)) return this.nouns.get(s);
    for (const k of this.nounKeys) if (s.endsWith(k)) return this.nouns.get(k);
    return null;
  }

  parse(text) {
    let s = text.replace(/[\s　！？。、!?]+/g, "");
    s = s.replace(/ください$/, "").replace(/(します|しよう|しろ)$/, "する");
    if (!s) return null;
    for (const c of dictionaryForms(s)) {
      if (SPECIAL[c]) return SPECIAL[c];
      if (c.endsWith("する") && SPECIAL[c.slice(0, -2)]) return SPECIAL[c.slice(0, -2)];
      const m = c.match(DIR_RE);
      if (m) return DIRS[m[1]];
    }
    let verb = null;
    outer: for (const c of dictionaryForms(s)) {
      for (const [form, withO, noO] of this.verbs) {
        for (const tail of [form, form + "する"]) {
          if (c.endsWith(tail)) { verb = [withO, noO]; s = c.slice(0, -tail.length); break outer; }
        }
      }
    }
    if (!verb) return null;
    let [withO, noO] = verb;
    // 名詞の中の「に」「で」などで切らないよう、知っている名詞をいったん記号に置き換える
    const held = [];
    for (const k of this.nounKeys) {
      if (k.length > 1 && PARTICLE_RE.test(k) && s.includes(k)) {
        held.push(k);
        s = s.split(k).join(`\u0000${held.length - 1}\u0000`);
      }
    }
    const tokens = s.split(PARTICLE_RE).map(t => t.replace(/\u0000(\d+)\u0000/g, (_, n) => held[+n]));
    let o = null, i = null, ip = "";
    for (let k = 0; k + 1 < tokens.length; k += 2) {
      const word = tokens[k], part = tokens[k + 1];
      if (!word) continue;
      if (part === "を") o = word; else { i = word; ip = part; }
    }
    const rest = tokens.length % 2 === 1 ? tokens[tokens.length - 1] : "";
    if (rest && !o) o = rest;
    let oEn = o ? this.noun(o) : null;
    let iEn = i ? this.noun(i) : null;
    if ((o && !oEn) || (i && !iEn)) return null;
    if (!oEn) {
      if (iEn && withO.includes("{o}")) { oEn = iEn; iEn = null; }
      else if (noO) return noO;
      else return null;
    }
    if (withO.includes("|")) withO = withO.split("|")[iEn ? 1 : 0];
    let cmd = withO.split("{o}").join(oEn);
    if (ip === "の上に" || ip === "の上へ") cmd = cmd.replace(" in {i}", " on {i}");
    if (iEn) {
      if (cmd.includes("[")) cmd = cmd.replace(/[\[\]]/g, "");
      else if (!cmd.includes("{i}")) cmd += ({ "で": " with {i}", "から": " from {i}", "と": " with {i}" }[ip] || " to {i}");
      cmd = cmd.split("{i}").join(iEn);
    } else cmd = cmd.replace(/\[.*?\]/g, "");
    if (cmd.includes("{i}")) return null;
    if (cmd.startsWith("open ") && iEn === "key") cmd = cmd.replace("open ", "unlock ");
    return cmd;
  }
}

if (typeof module !== "undefined") module.exports = { Translator, CommandParser, norm };
