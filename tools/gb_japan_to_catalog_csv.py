#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""사내 '일본' 제품 엑셀 → 배터리 카달로그 앱 임포트용 CSV 변환기.

battery_catalog.html 의 [데이터 관리 → CSV 가져오기] 에 그대로 넣을 수 있는
표준 헤더로 바꿔준다.  엑셀 원본에는 고객품번·납품처·오더량 같은 영업 정보가
들어 있으므로 변환 결과 CSV 는 저장소에 커밋하지 말 것.  (이 저장소는 공개다.)

사용법:
    python3 tools/gb_japan_to_catalog_csv.py 일본제품리스트.xlsx gb_japan.csv

원본 시트 가정 (2행이 헤더, 3행부터 데이터):
    C 제품형명 / D 제품군 / I 고객사용 자재번호 / J 납품처 / W~AA 설계치 /
    AB~AK 표기치 / AS 최종유형 / AT~AV 오더량 / AX~AY 판매실적
"""
import csv
import re
import sys

try:
    import openpyxl
except ImportError:  # pragma: no cover
    sys.exit("openpyxl 이 필요합니다:  pip install openpyxl")

# 열 인덱스(0-base). 원본 서식이 바뀌면 여기만 고치면 된다.
COL = {
    "model": 2, "group": 3, "plate": 4, "cust_pn": 8, "dist": 9,
    "d_c20": 22, "d_rc": 23, "d_sae": 24, "d_en": 25,
    "m_c20": 27, "m_rc": 29, "m_sae": 33, "m_en": 35,
    "verdict": 44, "o23": 45, "o24": 46, "o25": 47, "s25": 49, "s26": 50,
}

# 납품처 이름에 국가/지역이 들어 있으면 그걸 판매지역으로 본다.
# (해외 법인 채널은 법인 소재국이 곧 판매지역이다.)
REGION_KEYWORDS = [
    ("HONG KONG", "홍콩"), ("INDONESIA", "인도네시아"), ("MALAYSIA", "말레이시아"),
    ("TAIWAN", "대만"), ("THAI", "태국"), ("VIETNAM", "베트남"),
    ("SINGAPORE", "싱가포르"), ("PHILIPPIN", "필리핀"), ("INDIA", "인도"),
    ("KOREA", "한국"), ("CHINA", "중국"), ("JAPAN", "일본"),
]


def region_of(dist, default):
    up = dist.upper()
    for needle, region in REGION_KEYWORDS:
        if needle in up:
            return region
    return default

# 제품군 → (규격체계, 용도).  규격별 치수는 앱의 규격 마스터에서 채운다.
JIS_PASSENGER = {"B17", "B19", "B20", "B24", "D20", "D23", "D26", "D31"}
JIS_TRUCK = {"E41", "F51", "G51", "H52", "12M24"}
EU_GROUPS = {"LN0", "LN1", "LN2", "LN3", "LN4", "LN5", "LN6",
             "LBN1", "LBN2", "LBN3", "LBN4", "EN B", "EN C"}
MARINE_RE = re.compile(r"\b(M2[0-9]|HCM|MS)\b|M2[4-7]-|MS[0-9]", re.I)


def norm(value):
    """엑셀 셀 → 문자열. None 과 '-' 는 빈 값으로 본다."""
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text in {"-", "N/A", "#N/A"} else text


def num(value):
    text = norm(value).replace(",", "")
    if not text:
        return ""
    try:
        return str(int(float(text)))
    except ValueError:
        return ""


# 12V SLI 로 있을 수 있는 값의 범위.  원본에 다른 열 값이 섞여 들어온 셀이
# 있어서(예: C20 칸에 자재코드) 범위를 벗어나면 버리고 표기치로 대체한다.
SANE = {"d_c20": (10, 300), "d_rc": (10, 700), "d_sae": (100, 2000), "d_en": (100, 2000)}


def sane(key, text):
    if not text:
        return ""
    lo, hi = SANE[key]
    return text if lo <= int(text) <= hi else ""


def classify(group, model):
    """제품군 → (규격체계, 기술, 용도)."""
    base = group[4:].strip() if group.startswith("EFB") else group
    base = re.sub(r"\(.*\)", "", base).strip()
    tech = "EFB" if group.startswith("EFB") else "일반액식"

    if base in JIS_TRUCK:
        return "JIS", tech, "상용차"
    if base.startswith("BCI") or base == "8D":
        app = "마린/듀얼" if MARINE_RE.search(model) else (
            "상용차" if base in {"BCI 31", "8D"} else "승용SLI")
        return "BCI", tech, app
    if base in EU_GROUPS:
        return "DIN/EN", tech, "상용차" if base in {"EN B", "EN C"} else "승용SLI"
    if base in JIS_PASSENGER or re.match(r"^[A-Z]\d{2}$", base):
        app = "마린/듀얼" if MARINE_RE.search(model) else "승용SLI"
        return "JIS", tech, app
    if base in {"N55", "M42", "K42", "Q85", "S95", "T110"}:
        return "JIS", tech, "승용SLI"
    return "기타", tech, "미분류"


HEADER = [
    "구분", "제조사", "브랜드", "모델", "규격그룹", "규격체계", "기술", "용도",
    "전압", "C20용량", "RC분", "CCA_SAE", "CCA_EN",
    "판매지역", "유통사", "고객품번",
    "표기_C20", "표기_RC", "표기_CCA_SAE", "표기_CCA_EN", "스펙판정",
    "오더23", "오더24", "오더25", "판매25", "판매26",
    "검증상태", "출처", "비고",
]


def convert(src, dst, default_region="일본", maker="세방전지", brand="GB"):
    sheet = openpyxl.load_workbook(src, data_only=True).worksheets[0]
    rows = [r for r in sheet.iter_rows(values_only=True) if norm(r[COL["model"]])]
    rows = rows[1:] if norm(rows[0][COL["model"]]) == "제품형명" else rows

    # 형명별 설계치는 빈 칸이 섞여 있다. 형명 단위로 채워 쓴다.
    canon = {}
    for row in rows:
        model = norm(row[COL["model"]])
        spec = canon.setdefault(model, {})
        for key in ("d_c20", "d_rc", "d_sae", "d_en"):
            if not spec.get(key):
                spec[key] = sane(key, num(row[COL[key]]))

    out = []
    for row in rows:
        model = norm(row[COL["model"]])
        if model == "단종":
            continue
        group = norm(row[COL["group"]]) or "미분류"
        dist = norm(row[COL["dist"]])
        std, tech, app = classify(group, model)
        spec = canon[model]
        # 설계치가 비었으면 라벨 표기치로 채운다.
        fallback = {"d_c20": "m_c20", "d_rc": "m_rc", "d_sae": "m_sae", "d_en": "m_en"}
        eff = {}
        for key, mkey in fallback.items():
            eff[key] = spec.get(key) or sane(key, num(row[COL[mkey]]))
        out.append([
            "자사", maker, brand, model, group, std, tech, app, "12",
            eff["d_c20"], eff["d_rc"], eff["d_sae"], eff["d_en"],
            region_of(dist, default_region),
            dist, norm(row[COL["cust_pn"]]),
            num(row[COL["m_c20"]]), num(row[COL["m_rc"]]),
            num(row[COL["m_sae"]]), num(row[COL["m_en"]]),
            norm(row[COL["verdict"]]),
            num(row[COL["o23"]]), num(row[COL["o24"]]), num(row[COL["o25"]]),
            num(row[COL["s25"]]), num(row[COL["s26"]]),
            "사내설계치", "사내 제품리스트", "",
        ])

    with open(dst, "w", encoding="utf-8-sig", newline="") as fp:
        writer = csv.writer(fp)
        writer.writerow(HEADER)
        writer.writerows(out)
    return len(out)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    count = convert(sys.argv[1], sys.argv[2])
    print(f"{count} 행 변환 완료 → {sys.argv[2]}")
