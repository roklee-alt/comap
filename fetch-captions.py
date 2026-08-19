#!/usr/bin/env python3
"""인스타그램 공개 임베드(embed/captioned)에서 게시물 전체 캡션을 백필한다.
- 입력: source-posts.csv (post_url)
- 출력: captions-full.csv (post_url, status, caption) — 재실행 시 이어받기
"""
import csv
import html
import os
import random
import re
import subprocess
import sys
import time

SRC = "source-posts.csv"
OUT = "captions-full.csv"
# 주의: 최신 Chrome UA를 보내면 React 쉘이 내려와 캡션이 없다. 짧은 UA여야 정적 임베드가 온다.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def parse_caption(raw):
    m = re.search(r'<div class="Caption">(.*?)(?:<div class="CaptionComments|</div>\s*<div class="Footer)', raw, re.S)
    block = m.group(1) if m else ""
    if not block:
        m = re.search(r'<div class="Caption">(.*?)</div>', raw, re.S)
        block = m.group(1) if m else ""
    block = re.sub(r'<a class="CaptionUsername".*?</a>', "", block, flags=re.S)
    block = re.sub(r"<br\s*/?>", "\n", block)
    block = re.sub(r"<[^>]+>", " ", block)
    text = html.unescape(block)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def fetch(url):
    embed = url.rstrip("/") + "/embed/captioned/"
    res = subprocess.run(
        ["curl", "-s", "-L", "--max-time", "20", "-A", UA, embed],
        capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"curl exit {res.returncode}")
    return res.stdout


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
    urls = []
    seen_src = set()
    with open(SRC, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            u = row["post_url"]
            if u not in seen_src:
                seen_src.add(u)
                urls.append(u)

    done = set()
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if row["status"] == "ok":
                    done.add(row["post_url"])

    todo = [u for u in urls if u not in done]
    print(f"전체 {len(urls)} / 완료 {len(done)} / 남음 {len(todo)}", flush=True)

    new_file = not os.path.exists(OUT)
    with open(OUT, "a", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(["post_url", "status", "caption"])
        ok = fail = 0
        for i, u in enumerate(todo[:limit]):
            try:
                raw = fetch(u)
                cap = parse_caption(raw)
                if cap:
                    w.writerow([u, "ok", cap])
                    ok += 1
                else:
                    w.writerow([u, "empty", ""])
                    fail += 1
            except Exception as e:
                code = getattr(e, "code", None)
                w.writerow([u, f"error:{code or type(e).__name__}", ""])
                fail += 1
                if code == 429:
                    print("429 — 60초 대기", flush=True)
                    time.sleep(60)
            if (i + 1) % 50 == 0:
                f.flush()
                print(f"{i + 1}/{len(todo)} (ok {ok} / fail {fail})", flush=True)
            time.sleep(1.2 + random.random() * 0.8)
    print(f"종료: ok {ok} / fail {fail}", flush=True)


if __name__ == "__main__":
    main()
