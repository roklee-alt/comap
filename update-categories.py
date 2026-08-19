#!/usr/bin/env python3
"""카테고리 정비: 걸스→뷰티 개명 + 술집 세부 태그(카카오 업종·캡션 기반) 추가.
data.js를 직접 갱신한다. 재실행해도 안전(멱등)."""
import csv
import json
import os

BAR_SUBTAGS = {
    "와인·칵테일": {"와인바", "칵테일바"},
    "이자카야": {"일본식주점", "일식", "일식집", "오뎅바"},
    "맥주·펍": {"호프,요리주점"},
}
NOPO_KEYWORDS = ["노포", "포차", "대포집"]


def load_captions():
    caps = {}
    if os.path.exists("captions-full.csv"):
        with open("captions-full.csv", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if row["status"] == "ok":
                    caps[row["post_url"]] = row["caption"]
    return caps


def main():
    caps = load_captions()
    with open("data.js", encoding="utf-8") as f:
        raw = f.read()
    prefix = "window.KNEWNEW_DATA = "
    payload = json.loads(raw[len(prefix):].rstrip().rstrip(";"))

    renamed = subtagged = nopo = 0
    for p in payload["places"]:
        cats = p.get("categories") or []
        if "걸스" in cats:
            cats = ["뷰티" if c == "걸스" else c for c in cats]
            renamed += 1
        if "술집" in cats:
            kc = p.get("kakao_category") or ""
            for tag, kinds in BAR_SUBTAGS.items():
                if kc in kinds and tag not in cats:
                    cats.append(tag)
                    subtagged += 1
                    break
            else:
                text = " ".join(caps.get(m["post_url"], "") for m in p.get("mentions", []))
                if any(k in text for k in NOPO_KEYWORDS) and "노포·포차" not in cats:
                    cats.append("노포·포차")
                    nopo += 1
        p["categories"] = cats

    with open("data.js", "w", encoding="utf-8") as f:
        f.write(prefix + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";")
    print(f"걸스→뷰티 {renamed}곳 · 술집 세부태그 {subtagged}곳 · 노포·포차 {nopo}곳")


if __name__ == "__main__":
    main()
