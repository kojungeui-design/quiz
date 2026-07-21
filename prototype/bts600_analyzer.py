#!/usr/bin/env python3
"""
BTS-600 시험 데이터 분석기 (5번 에이전트 프로토타입)

Digatron BTS-600 (V 1.600.395) 의 Measuring data list CSV export 를 읽어
- 시험 메타데이터 추출
- 구간(충전/방전/휴지)별 요약
- 이상 징후 자동 감지
- 사람이 읽는 요약 리포트 생성

시험기 프로그램은 건드리지 않는다. C:\\bts600 폴더에 쌓이는 export 파일만 읽는다.
"""

import csv
import io
import sys
from dataclasses import dataclass, field


# ── 데이터 구조 ────────────────────────────────────────────────

@dataclass
class TestMeta:
    battery_id: str = ""
    program: str = ""
    circuit: str = ""
    test_section: str = ""
    start: str = ""
    end: str = ""
    version: str = ""

    @property
    def running(self) -> bool:
        # BTS-600 은 미종료 시험의 End of test 를 01-01-00 00:00:00 으로 기록
        return self.end.startswith("01-01-00") or self.end == ""


@dataclass
class Row:
    step: str
    status: str
    program_time_h: float
    voltage: float
    current: float
    temp: float | None
    ah_accu: float | None


@dataclass
class Finding:
    level: str      # INFO / WARN / ALARM
    message: str


# ── 파서 ───────────────────────────────────────────────────────

def _to_float(s):
    s = (s or "").strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _ptime_to_hours(s):
    # "191:48:13" → 191.80  (시:분:초, 시가 24 초과 가능)
    parts = (s or "").split(":")
    if len(parts) != 3:
        return None
    try:
        h, m, sec = (int(p) for p in parts)
        return h + m / 60 + sec / 3600
    except ValueError:
        return None


def parse(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()

    meta = TestMeta()
    rows = []
    reader = list(csv.reader(io.StringIO(text)))

    # 1) 메타데이터 스캔 + 데이터 헤더 위치 찾기
    header_idx = None
    col = {}
    for i, rec in enumerate(reader):
        if not rec:
            continue
        key = rec[0].strip()
        if key == "Battery ID:":
            meta.battery_id = rec[1].strip() if len(rec) > 1 else ""
        elif key == "Program:":
            meta.program = rec[1].strip() if len(rec) > 1 else ""
        elif key == "Circuit:":
            meta.circuit = rec[1].strip() if len(rec) > 1 else ""
        elif key == "Test section:":
            meta.test_section = rec[1].strip() if len(rec) > 1 else ""
            # 같은 행에 Start/End of test 가 들어있음
            for j, cell in enumerate(rec):
                if cell.strip() == "Start of test:" and j + 1 < len(rec):
                    meta.start = f"{rec[j+1].strip()} {rec[j+2].strip()}"
                if cell.strip() == "End of test:" and j + 1 < len(rec):
                    meta.end = f"{rec[j+1].strip()} {rec[j+2].strip()}"
        elif key == "Step" and "Status" in rec:
            header_idx = i
            col = {name.strip(): idx for idx, name in enumerate(rec)}
            break

    for cell in reader[2] if len(reader) > 2 else []:
        if cell.strip().startswith("Version:"):
            meta.version = cell.split(":", 1)[1].strip()

    if header_idx is None:
        raise ValueError("데이터 헤더(Step,Status,...)를 찾지 못함 — BTS-600 export 형식이 아님")

    # 2) 데이터 행 파싱 (units 행 다음부터). Temp 컬럼은 있을 수도 없을 수도.
    def g(rec, name):
        idx = col.get(name)
        return rec[idx] if idx is not None and idx < len(rec) else ""

    for rec in reader[header_idx + 2:]:
        if not rec or not rec[0].strip():
            continue
        status = g(rec, "Status").strip()
        if status == "":
            continue
        rows.append(Row(
            step=g(rec, "Step").strip(),
            status=status,
            program_time_h=_ptime_to_hours(g(rec, "Program time")) or 0.0,
            voltage=_to_float(g(rec, "Voltage")) or 0.0,
            current=_to_float(g(rec, "Current")) or 0.0,
            temp=_to_float(g(rec, "Temp")),
            ah_accu=_to_float(g(rec, "AhAccu")),
        ))

    return meta, rows


# ── 분석 ───────────────────────────────────────────────────────

# 12V 납축전지 기준 판정 임계값 (사내 규격에 맞춰 조정)
DISCHARGE_FLOOR_V = 10.50   # 방전 종지전압 하한 (이하로 내려가면 과방전 의심)
CHARGE_CEILING_V = 16.20    # 충전 상한 (초과 시 과충전/설비 이상)
TEMP_ALARM_C = 60.0         # 온도 경보
TEMP_INVALID_C = -40.0      # 이하는 물리적 불가값 → 센서 미연결/단선 (BTS-600은 -270.49 기록)
GAP_ALARM_H = 1.0           # 로깅 공백 경보 (정상 10분 간격 대비)


def analyze(meta, rows):
    findings: list[Finding] = []

    if not rows:
        findings.append(Finding("ALARM", "데이터 행이 없음 — 채널 미기록 또는 파일 손상 의심"))
        return findings, {}

    volts = [r.voltage for r in rows if r.voltage]
    temps_raw = [r.temp for r in rows if r.temp is not None]
    temps = [t for t in temps_raw if t > TEMP_INVALID_C]      # 유효 온도만
    temps_invalid = [t for t in temps_raw if t <= TEMP_INVALID_C]  # 센서 미연결값
    duration_h = max(r.program_time_h for r in rows)
    dch = [r for r in rows if r.status == "DCH"]
    cha = [r for r in rows if r.status == "CHA"]

    summary = {
        "battery": meta.battery_id,
        "program": meta.program,
        "section": meta.test_section,
        "rows": len(rows),
        "duration_h": round(duration_h, 1),
        "v_min": round(min(volts), 3) if volts else None,
        "v_max": round(max(volts), 3) if volts else None,
        "t_max": round(max(temps), 1) if temps else None,
        "dch_rows": len(dch),
        "cha_rows": len(cha),
        "running": meta.running,
    }

    # 1) 방전 종지전압 하한 이탈
    low = [r for r in dch if r.voltage and r.voltage < DISCHARGE_FLOOR_V]
    if low:
        worst = min(low, key=lambda r: r.voltage)
        findings.append(Finding(
            "ALARM",
            f"방전 중 종지전압 하한({DISCHARGE_FLOOR_V}V) 이탈 {len(low)}회 — "
            f"최저 {worst.voltage:.3f}V @ {worst.program_time_h:.1f}h. 과방전/시료 열화 의심"))

    # 2) 충전 상한 초과
    high = [r for r in cha if r.voltage and r.voltage > CHARGE_CEILING_V]
    if high:
        worst = max(high, key=lambda r: r.voltage)
        findings.append(Finding(
            "WARN",
            f"충전 중 전압 상한({CHARGE_CEILING_V}V) 초과 {len(high)}회 — "
            f"최고 {worst.voltage:.3f}V. 설비/설정 확인 필요"))

    # 3) 온도 경보 / 센서 미연결 감지
    if temps_invalid and not temps:
        findings.append(Finding(
            "WARN",
            f"온도센서 미연결/단선 — 전체 {len(temps_invalid)}개 로그가 물리적 불가값"
            f"({temps_invalid[0]:.2f}°C). 온도 감시 없이 시험됨"))
    elif temps:
        if temps_invalid:
            findings.append(Finding(
                "WARN",
                f"온도 로그 {len(temps_invalid)}개가 미연결값 — 측정 중 센서 접촉 불량 가능성"))
        hot = [t for t in temps if t >= TEMP_ALARM_C]
        if hot:
            findings.append(Finding(
                "ALARM",
                f"온도 경보 임계({TEMP_ALARM_C}°C) 도달 — 최고 {max(temps):.1f}°C. 안전 점검 필요"))
    else:
        findings.append(Finding(
            "INFO", "온도 채널 없음 — 이 시험은 온도 감시 미포함(export에 Temp 컬럼 없음)"))

    # 4) 로깅 공백 (설비 정지/채널 드롭 감지)
    prev = None
    max_gap = 0.0
    gap_at = None
    for r in rows:
        if prev is not None:
            gap = r.program_time_h - prev
            if gap > max_gap:
                max_gap, gap_at = gap, r.program_time_h
        prev = r.program_time_h
    if max_gap > GAP_ALARM_H:
        findings.append(Finding(
            "WARN",
            f"데이터 로깅 공백 {max_gap:.1f}h 발생 @ {gap_at:.1f}h — "
            f"설비 정지/전원/채널 드롭 가능성"))

    # 5) 전압 정체 (스턱 채널) — 방전 중인데 전압이 장시간 불변
    stuck = 0
    run = 0
    for i in range(1, len(dch)):
        if dch[i].voltage == dch[i-1].voltage and dch[i].current != 0:
            run += 1
            stuck = max(stuck, run)
        else:
            run = 0
    if stuck >= 30:  # 30 로그(약 5시간) 이상 완전 불변
        findings.append(Finding(
            "WARN",
            f"방전 중 전압이 {stuck} 로그 연속 불변 — 센서 스턱/측정 이상 가능성"))

    # 6) 진행 상태
    if meta.running:
        findings.append(Finding("INFO", f"시험 진행 중 (경과 {duration_h:.1f}h). 종료 미기록 상태"))

    return findings, summary


# ── 리포트 ─────────────────────────────────────────────────────

ICON = {"ALARM": "🔴", "WARN": "🟡", "INFO": "🔵"}


def report(meta, findings, summary):
    lines = []
    lines.append(f"■ 시험: {summary['section']}  |  시료: {summary['battery']}  |  프로그램: {summary['program']}")
    status = "진행 중" if summary["running"] else "종료"
    lines.append(f"  상태: {status}   경과: {summary['duration_h']}h   로그: {summary['rows']:,}행")
    v = f"{summary['v_min']}~{summary['v_max']}V" if summary["v_min"] else "N/A"
    t = f"최고 {summary['t_max']}°C" if summary["t_max"] is not None else "온도 미측정"
    lines.append(f"  전압: {v}   온도: {t}   방전 {summary['dch_rows']:,} / 충전 {summary['cha_rows']:,} 로그")
    lines.append("  ── 판정 ──")
    alarms = [f for f in findings if f.level == "ALARM"]
    if alarms:
        lines.append(f"  판정: ⚠ 이상 감지 ({len(alarms)}건 ALARM) — 담당자 확인 필요")
    else:
        lines.append("  판정: ✓ 임계 이탈 없음")
    for f in findings:
        lines.append(f"    {ICON[f.level]} [{f.level}] {f.message}")
    return "\n".join(lines)


# ── 실행 ───────────────────────────────────────────────────────

def main(paths):
    print("=" * 78)
    print("  BTS-600 시험 데이터 자동 분석 리포트  (5번 에이전트 프로토타입)")
    print("=" * 78)
    any_alarm = False
    for p in paths:
        try:
            meta, rows = parse(p)
            findings, summary = analyze(meta, rows)
            if any(f.level == "ALARM" for f in findings):
                any_alarm = True
            print()
            print(report(meta, findings, summary))
        except Exception as e:
            print(f"\n[파싱 실패] {p}: {e}")
    print()
    print("-" * 78)
    print("전체 판정:", "⚠ ALARM 포함 — 확인 요망" if any_alarm else "✓ 이상 없음")
    print("(임계값은 사내 규격에 맞춰 조정 가능. 실제 운영 시 매일/매주 자동 실행)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python bts600_analyzer.py <BTS600_export.csv> [...]")
        sys.exit(1)
    main(sys.argv[1:])
