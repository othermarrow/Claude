#!/usr/bin/env python3
import re, sys, glob, os
import yaml

FM_BLOCK_RE = re.compile(r'^---\r?\n(.*?)\r?\n---\r?\n', re.DOTALL)
WIKILINK_RE = re.compile(r'\[\[([^\[\]\|]+)(?:\|([^\[\]]+))?\]\]')

def strip_bom(text):
    return text.replace('\ufeff', '')

def find_md_files(path):
    if os.path.isfile(path):
        return [path]
    return glob.glob(os.path.join(path, '**', '*.md'), recursive=True)

def extract_display(value):
    def repl(m):
        path, alias = m.group(1), m.group(2)
        if alias:
            return alias
        base = path.rsplit('/', 1)[-1]
        if base.endswith('.md'):
            base = base[:-3]
        return base
    return WIKILINK_RE.sub(repl, value)

def clean_value(v):
    if isinstance(v, str):
        return extract_display(v)
    if isinstance(v, list):
        cleaned = [clean_value(x) for x in v]
        seen, out = set(), []
        for x in cleaned:
            key = x if isinstance(x, str) else repr(x)
            if key not in seen:
                seen.add(key)
                out.append(x)
        return out
    if isinstance(v, dict):
        return {k: clean_value(x) for k, x in v.items()}
    return v

def fix_content(text):
    text = strip_bom(text)
    m = FM_BLOCK_RE.match(text)
    if not m:
        return text, False, []
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return text, False, []
    if not isinstance(data, dict):
        return text, False, []

    changed_keys = []
    new_data = {}
    for k, v in data.items():
        cleaned = clean_value(v)
        if cleaned != v:
            changed_keys.append(k)
        new_data[k] = cleaned

    if not changed_keys:
        return text, False, []

    new_yaml = yaml.dump(new_data, allow_unicode=True, sort_keys=False)
    rest = text[m.end():]
    new_text = f"---\n{new_yaml}---\n{rest}"
    return new_text, True, changed_keys

def main():
    if len(sys.argv) < 2:
        print("使い方: python extract_wikilink_text.py <ファイル or ディレクトリ> [--apply]")
        sys.exit(1)
    target = sys.argv[1]
    apply = '--apply' in sys.argv
    files = find_md_files(target)
    changed = 0
    for path in files:
        with open(path, encoding='utf-8') as f:
            original = f.read()
        fixed, did, keys = fix_content(original)
        if not did:
            continue
        changed += 1
        tag = "" if apply else "（プレビューのみ）"
        print(f"[{path}] Wikilinkをテキスト化{tag}: {', '.join(keys)}")
        if apply:
            with open(path + '.bak', 'w', encoding='utf-8') as f:
                f.write(original)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(fixed)
    if changed == 0:
        print("対象は見つかりませんでした")
    elif not apply:
        print("\n--apply を付けて再実行すると実際に書き換えます（元ファイルは.bakに保存）")

if __name__ == '__main__':
    main()
