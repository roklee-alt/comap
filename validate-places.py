#!/usr/bin/env python3
"""장소-게시물 교차검증: 캡션의 지역 신호와 매칭된 주소를 대조해
confirmed / suspect_overseas / region_conflict / unknown 으로 분류하고,
의심 장소를 data.js에 geo_suspect로 표시한다.

사용법:
  python3 validate-places.py           # 리포트만 생성 (validation-report.csv)
  python3 validate-places.py --apply   # data.js에 geo_suspect 플래그 반영
"""
import csv
import json
import os
import re
import sys

OVERSEAS = [
    "일본", "도쿄", "오사카", "교토", "후쿠오카", "삿포로", "나고야", "오키나와",
    "방콕", "치앙마이", "다낭", "하노이", "호치민", "나트랑", "냐짱",
    "파리", "런던", "뉴욕", "하와이", "발리", "세부", "보라카이",
    "대만", "타이베이", "홍콩", "마카오", "상하이", "베이징", "싱가포르",
    "괌", "사이판", "몽골", "스위스", "프라하", "로마", "피렌체", "바르셀로나",
    "베트남", "태국", "유럽", "해외",
]
# '일본 감성 카페', '여기 해외 아니고' 같은 국내 묘사 패턴 → 해외 신호 무효화
DOMESTIC_PATTERNS = [
    "아니고", "아니라", "아니야", "한국", "국내", "우리나라",
    "감성", "느낌", "무드", "스타일", "인테리어", "빈티지 러버",  # ← 마지막 항목은 검토 필요
]
DOMESTIC_PATTERNS.remove("빈티지 러버")  # 도쿄 빈티지샵 소개 게시물이 실제로 있어 제외

KOREA_CITIES = [
    "서울", "부산", "대구", "인천", "대전", "울산", "제주", "세종",
    "수원", "성남", "고양", "용인", "파주", "김포", "인천", "춘천", "강릉", "속초",
    "양양", "원주", "전주", "군산", "여수", "순천", "목포", "광양", "경주", "포항",
    "통영", "거제", "남해", "하동", "창원", "진주", "김해", "양산", "천안", "공주",
    "서산", "보령", "단양", "제천", "청주", "안동", "문경", "양평", "가평", "이천",
]


def load_posts(path="source-posts.csv"):
    captions = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            captions[row["post_url"]] = row.get("caption_first_line") or ""
    # 전체 캡션 백필(captions-full.csv)이 있으면 첫 줄 대신 전문을 사용
    if os.path.exists("captions-full.csv"):
        full = 0
        with open("captions-full.csv", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if row.get("status") == "ok" and row.get("caption"):
                    captions[row["post_url"]] = row["caption"]
                    full += 1
        print(f"전체 캡션 사용: {full}건 (나머지는 첫 줄)")
    return captions


SUFFIX_OK = set("으에은는이가의도시군구로를만과와랑엔서엔행맛코")  # 조사·행정 접미(제주'도', 보은'으로', 강릉'코스')


def hangul_boundary_find(text, kw, near_exclude=None):
    """2글자 이하 지명은 앞이 한글이면 다른 단어의 일부로 보고 무시 (기'대만'큼 방지).
    뒤는 조사·접미가 자연스럽게 붙으므로 허용 목록으로 판단.
    near_exclude: 매치 주변 ±8자에 이 단어가 있으면 무시 ('서울 근교' 등)."""
    for m in re.finditer(re.escape(kw), text):
        if near_exclude:
            window = text[max(0, m.start() - 8):m.end() + 8]
            if near_exclude in window:
                continue
        if len(kw) >= 3:
            return True
        before = text[m.start() - 1] if m.start() > 0 else " "
        after = text[m.end()] if m.end() < len(text) else " "
        if "가" <= before <= "힣":
            continue
        if not ("가" <= after <= "힣") or after in SUFFIX_OK:
            return True
    return False


def address_tokens(place):
    """주소·지역힌트에서 대조용 토큰 추출: 시도 첫 단어, 시군구, 읍면동, area_hint."""
    tokens = set()
    addr = place.get("address") or ""
    parts = addr.split()
    for p in parts[:3]:
        tokens.add(p)
        stem = re.sub(r"(특별자치도|특별자치시|광역시|특별시|도|시|군|구|읍|면|동|리)$", "", p)
        if len(stem) >= 2:
            tokens.add(stem)
    hint = place.get("area_hint") or ""
    if 2 <= len(hint) <= 6:
        tokens.add(hint)
        tokens.add(re.sub(r"(동|읍|면|리)$", "", hint))
    return {t for t in tokens if len(t) >= 2}


def classify(place, captions):
    caps = [captions.get(m["post_url"], "") for m in place.get("mentions", [])]
    caps = [c for c in caps if c]
    if not caps:
        return "unknown", "", ""
    joined = " | ".join(caps)
    tokens = address_tokens(place)

    # 1) 캡션에 자기 주소 지역이 그대로 등장 → 확인
    for t in tokens:
        if hangul_boundary_find(joined, t):
            return "confirmed", t, joined[:80]

    domestic = any(p in joined for p in DOMESTIC_PATTERNS)

    # 2) 해외 지명 등장 + 국내 묘사 패턴 없음 → 의심
    for kw in OVERSEAS:
        if hangul_boundary_find(joined, kw):
            if domestic:
                return "unknown", f"~{kw}(국내묘사)", joined[:80]
            return "suspect_overseas", kw, joined[:80]

    # 3) 다른 국내 도시가 등장 → 지역 충돌 검수 ('서울 근교' 같은 비유는 제외)
    for city in KOREA_CITIES:
        if city in tokens:
            continue
        if hangul_boundary_find(joined, city, near_exclude="근교"):
            return "region_conflict", city, joined[:80]

    return "unknown", "", joined[:60]


def geo_coherence(places):
    """같은 area_hint(썸네일의 '이름 | 지역' 지역부)를 가진 장소들은 지리적으로 뭉쳐야 한다.
    힌트 그룹의 중앙값 좌표에서 크게 벗어난 장소 = 동명 오매칭 의심."""
    import math

    def dist_km(a, b):
        rad = math.pi / 180
        x = (b[1] - a[1]) * rad * math.cos((a[0] + b[0]) / 2 * rad)
        y = (b[0] - a[0]) * rad
        return 6371 * math.hypot(x, y)

    groups = {}
    for p in places:
        h = (p.get("area_hint") or "").strip()
        if 2 <= len(h) <= 10:
            groups.setdefault(h, []).append(p)

    # 동명 동네(해운대 중동 vs 인천 중동)가 한 그룹에 섞이므로 중심점 대신 '고립' 판정:
    # 같은 힌트의 다른 장소가 반경 안에 하나도 없을 때만 의심.
    outliers = []
    for hint, members in groups.items():
        if len(members) < 3:
            continue
        narrow = hint[-1] in "동역리가"
        limit = 8 if narrow else 40
        for m in members:
            nearest = min(
                (dist_km((m["lat"], m["lng"]), (o["lat"], o["lng"]))
                 for o in members if o is not m),
                default=0,
            )
            if nearest > limit:
                outliers.append((m, hint, round(nearest)))
    return outliers


def main():
    apply = "--apply" in sys.argv
    captions = load_posts()
    with open("places-all.json", encoding="utf-8") as f:
        data = json.load(f)
    places = [p for p in data["places"] if p.get("resolved")]

    results = {}
    counts = {}
    rows = []
    for p in places:
        verdict, signal, cap = classify(p, captions)
        counts[verdict] = counts.get(verdict, 0) + 1
        results[p["id"]] = verdict
        if verdict != "unknown":
            rows.append([verdict, p["name"], p.get("address", ""), signal, cap,
                         p.get("recommendation_count", 0)])

    # 좌표 자기검증: 힌트 그룹에서 튀는 장소
    for p, hint, d in geo_coherence(places):
        if results.get(p["id"]) == "confirmed":
            continue
        results[p["id"]] = "hint_outlier"
        counts["hint_outlier"] = counts.get("hint_outlier", 0) + 1
        rows.append(["hint_outlier", p["name"], p.get("address", ""),
                     f"{hint} 그룹에서 {d}km", "", p.get("recommendation_count", 0)])

    rows.sort(key=lambda r: (r[0], -int(r[5])))
    with open("validation-report.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["verdict", "name", "address", "signal", "caption", "recommendations"])
        w.writerows(rows)

    print("분류 결과:", counts)

    if apply:
        # 규칙이 아니라 수동 판정 목록(curated-suspects.txt)만 실제로 숨긴다.
        curated = set()
        with open("curated-suspects.txt", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    curated.add(line)
        with open("data.js", encoding="utf-8") as f:
            raw = f.read()
        prefix = "window.KNEWNEW_DATA = "
        payload = json.loads(raw[len(prefix):].rstrip().rstrip(";"))
        n = 0
        hidden = []
        for p in payload["places"]:
            if p.get("name") in curated and results.get(p["id"]) in ("suspect_overseas", "region_conflict"):
                p["geo_suspect"] = results[p["id"]]
                hidden.append(p["name"])
                n += 1
            elif results.get(p["id"]) == "confirmed":
                p["geo_confirmed"] = True
        with open("data.js", "w", encoding="utf-8") as f:
            f.write(prefix + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";")
        print(f"data.js 반영: geo_suspect {n}건 → {sorted(hidden)}")


if __name__ == "__main__":
    main()
