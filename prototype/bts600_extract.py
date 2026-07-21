#!/usr/bin/env python3
"""
BTS-600 → 시험 관리대장 자동 채움 (2번/5번 에이전트 프로토타입)

담당자가 로우데이터(BTS-600 export CSV)를 열어 눈으로 찾아 관리대장(xlsx)에
손으로 옮겨적는 값들을, CSV에서 자동으로 추출한다.

검증: HKMC_SOC 관리대장의 'GB L6' 시트(#1 Batt0020, #3 Batt0016) 값과 대조.
"""

import csv
import io
import sys
from dataclasses import dataclass


@dataclass
class Step:
    idx: str
    status: str          # CHA / DCH / PAU
    logs: int
    end_voltage: float   # 구간 종료 전압 (휴지 종료 = 안정화/OCV 전압)
    ah_cha: float        # 구간 종료 시점 누적 충전 Ah
    ah_dch: float        # 구간 종료 시점 누적 방전 Ah
    dur_h: float


def _f(s):
    s = (s or "").strip()
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _hours(s):
    p = (s or "").split(":")
    if len(p) != 3:
        return 0.0
    try:
        return int(p[0]) + int(p[1]) / 60 + int(p[2]) / 3600
    except ValueError:
        return 0.0


def parse(path):
    reader = list(csv.reader(io.StringIO(open(path, encoding="utf-8", errors="replace").read())))
    meta = {"battery": "", "program": "", "circuit": "", "section": ""}
    hidx, col = None, {}
    for i, r in enumerate(reader):
        if not r:
            continue
        k = r[0].strip()
        if k == "Battery ID:":
            meta["battery"] = r[1].strip() if len(r) > 1 else ""
        elif k == "Program:":
            meta["program"] = r[1].strip() if len(r) > 1 else ""
        elif k == "Circuit:":
            meta["circuit"] = r[1].strip() if len(r) > 1 else ""
        elif k == "Test section:":
            meta["section"] = r[1].strip() if len(r) > 1 else ""
        elif k == "Step" and "Status" in r:
            hidx = i
            col = {n.strip(): j for j, n in enumerate(r)}
            break
    if hidx is None:
        raise ValueError("BTS-600 형식 아님")

    def g(r, name):
        j = col.get(name)
        return r[j] if j is not None and j < len(r) else ""

    # 구간(Step+Status가 연속되는 블록) 단위로 집계
    steps, cur = [], None
    for r in reader[hidx + 2:]:
        if not r or not r[0].strip():
            continue
        st = g(r, "Status").strip()
        if st == "":
            continue
        sidx = g(r, "Step").strip()
        v = _f(g(r, "Voltage"))
        key = (sidx, st)
        if cur is None or cur["key"] != key:
            if cur:
                steps.append(cur)
            cur = {"key": key, "idx": sidx, "status": st, "logs": 0,
                   "v": None, "cha": None, "dch": None, "dur": 0.0}
        cur["logs"] += 1
        if v is not None:
            cur["v"] = v
        c, d = _f(g(r, "AhCha")), _f(g(r, "AhDch"))
        if c is not None:
            cur["cha"] = c
        if d is not None:
            cur["dch"] = d
        cur["dur"] = _hours(g(r, "Step time"))
    if cur:
        steps.append(cur)

    return meta, [Step(s["idx"], s["status"], s["logs"], s["v"] or 0.0,
                       s["cha"] or 0.0, s["dch"] or 0.0, s["dur"]) for s in steps]


def extract_tracking(meta, steps):
    """관리대장 항목 자동 추출."""
    out = {"시료": meta["battery"], "회로": meta["circuit"],
           "프로그램": meta["program"], "시험구간": meta["section"]}

    rests = [s for s in steps if s.status == "PAU"]

    # 총 방전용량 = 최종 누적 AhDch
    all_dch = [s.ah_dch for s in steps if s.ah_dch]
    out["총방전용량(Ah)"] = round(max(all_dch), 3) if all_dch else 0.0

    # 충전 용량 = 각 충전 구간의 '구간 증분' (누적 AhCha 차이). 관리대장이 적는 방식.
    charge_caps, base = [], 0.0
    for s in steps:
        if s.status == "CHA" and s.ah_cha:
            charge_caps.append(round(s.ah_cha - base, 3))
            base = s.ah_cha
    out["충전용량(Ah)"] = charge_caps

    # 안정화 전압 = 12h 이상 장기 휴지의 종료 전압
    long_rests = [r for r in rests if r.dur_h >= 12]
    out["안정화전압(휴지종료V)"] = [round(r.end_voltage, 3) for r in long_rests]

    # C20 SOC-OCV 곡선 = 방전 사이 6h 휴지들의 종료 전압 + 최종 방전 종지전압
    soc_rests = [r for r in rests if 3 <= r.dur_h <= 12]
    dch = [s for s in steps if s.status == "DCH"]
    curve = [round(r.end_voltage, 3) for r in soc_rests]
    if dch:
        curve.append(round(dch[-1].end_voltage, 3))  # SOC 0 = 방전 종지전압
    out["SOC구간 OCV(V)"] = curve

    return out


def main(paths):
    print("=" * 74)
    print("  BTS-600 → 시험 관리대장 자동 채움  (에이전트 프로토타입)")
    print("=" * 74)
    for p in paths:
        meta, steps = parse(p)
        t = extract_tracking(meta, steps)
        print(f"\n■ {t['시료']} / {t['회로']} / {t['프로그램']} / {t['시험구간']}")
        print(f"   충전용량(Ah)      : {t['충전용량(Ah)']}")
        print(f"   총방전용량(Ah)    : {t['총방전용량(Ah)']}")
        print(f"   안정화전압(V)     : {t['안정화전압(휴지종료V)']}")
        print(f"   SOC구간 OCV(V)    : {t['SOC구간 OCV(V)']}")
        print("   ── 구간 순서 ──")
        for s in steps:
            print(f"     Step{s.idx:>3} {s.status}  {s.dur_h:5.1f}h  "
                  f"종료 {s.end_voltage:6.3f}V  누적충전 {s.ah_cha:8.3f}  누적방전 {s.ah_dch:8.3f}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python bts600_extract.py <export.csv> [...]")
        sys.exit(1)
    main(sys.argv[1:])
