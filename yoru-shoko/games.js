// games.js — 書庫に並べるゲームの一覧。
// kind: "z" は Z マシンのゲームファイル（stories/）、"kura" は日本語で書き下ろしたゲーム（kura/）。
"use strict";
const GAMES = [
  {
    id: "kura", kind: "kura",
    title: "蔵守", sub: "山あいの旧家で、三晩。蔵の戸は開けてはいけない。",
    tags: [["日本語", "ja"], ["書き下ろし", ""], ["長編", ""]],
    endings: 8,
    scripts: ["kura/engine.js", "kura/house.js", "kura/village.js", "kura/night.js", "kura/extra.js"],
  },
  {
    id: "zork1", kind: "z", file: "stories/zork1.z3", dict: true,
    title: "ZORK I", sub: "The Great Underground Empire（1980・Infocom）",
    tags: [["日本語辞書つき", "ja"], ["MIT ライセンス", ""]],
  },
  {
    id: "zork2", kind: "z", file: "stories/zork2.z3",
    title: "ZORK II", sub: "The Wizard of Frobozz（1981・Infocom）",
    tags: [["英語（訳すボタン）", ""], ["MIT ライセンス", ""]],
  },
  {
    id: "zork3", kind: "z", file: "stories/zork3.z3",
    title: "ZORK III", sub: "The Dungeon Master（1982・Infocom）",
    tags: [["英語（訳すボタン）", ""], ["MIT ライセンス", ""]],
  },
];
