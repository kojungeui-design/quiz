#!/usr/bin/env python3
"""
시험 계획 → ① BTS-600 프로그램 입력 시트 자동 작성  ② 완료시점 예측  ③ 다음시험 알람

    python3 test_planner.py

계획(모델·샘플·시험순서)을 입력하면:
  - 각 시험을 BTS-600에 '어떤 프로그램으로 어떻게 입력'하는지 시트 생성
  - 프로그램별 소요시간으로 '언제 끝나는지' 예측 (시작일 기준)
  - 완료 전 '다음 시험 준비 알람' 시점 계산
"""

import json
from datetime import datetime, timedelta
from pathlib import Path

# ── 프로그램 사전 (실측·정의 기반, 실제 규격으로 조정) ─────────────
PROGRAMS = {
    "만충전": {
        "bts_program": "GGH_CHA",
        "duration_h": 24,
        "steps": [("정전류-정전압 충전", "전류 0.1C / 상한 16.0V / 24h")],
    },
    "C20": {
        "bts_program": "GGH_SOC",
        "duration_h": 96,
        "steps": [
            ("안정화 휴지", "72h 방치 후 OCV 측정"),
            ("C20 방전", "0.05C(=C/20) 방전, SOC 10%마다 6h 휴지, 종지 10.5V"),
        ],
    },
    "비중평가": {
        "bts_program": "GGH_SOCS",
        "duration_h": 30,
        "steps": [("만충전 후 비중 측정", "충전 완료 후 전해액 비중 측정")],
    },
    "수명(ISS)": {
        "bts_program": "PJS_ISS",
        "duration_h": 720,   # ~30일 (사이클 수에 따라)
        "steps": [("ISS 수명 사이클", "충·방전 반복, 지정 사이클까지")],
    },
}


def plan_test(model, samples, sequence, start_str):
    start = datetime.strptime(start_str, "%Y-%m-%d %H:%M")
    setup_sheet, schedule = [], []
    cursor = start

    for order, test in enumerate(sequence, 1):
        p = PROGRAMS.get(test)
        if not p:
            continue
        # ① 프로그램 입력 시트
        setup_sheet.append({
            "순서": order, "시험": test,
            "BTS_프로그램": p["bts_program"],
            "입력방법": [
                f"1) 배터리 목록에서 대상 회로 선택 (샘플 {', '.join(samples)})",
                f"2) 프로그램 = '{p['bts_program']}' 선택 후 회로에 할당",
                f"3) Nominal 값 입력 (모델 {model} 규격)",
            ] + [f"4-{i}) {s[0]}: {s[1]}" for i, s in enumerate(p["steps"], 1)]
            + ["5) Start 로 시험 시작"],
        })
        # ② 완료 예측
        end = cursor + timedelta(hours=p["duration_h"])
        schedule.append({
            "순서": order, "시험": test, "프로그램": p["bts_program"],
            "시작": cursor.strftime("%Y-%m-%d %H:%M"),
            "예상완료": end.strftime("%Y-%m-%d %H:%M"),
            "소요": f"{p['duration_h']}h (~{p['duration_h']/24:.1f}일)",
            # ③ 다음시험 준비 알람 = 완료 6시간 전
            "알람": (end - timedelta(hours=6)).strftime("%Y-%m-%d %H:%M"),
        })
        cursor = end

    return {"model": model, "samples": samples, "start": start_str,
            "final_end": cursor.strftime("%Y-%m-%d %H:%M"),
            "setup_sheet": setup_sheet, "schedule": schedule}


def print_plan(plan):
    print("=" * 76)
    print(f"  시험 계획  |  {plan['model']}  |  샘플 {', '.join(plan['samples'])}")
    print(f"  시작 {plan['start']}  →  전체 완료 예상 {plan['final_end']}")
    print("=" * 76)

    print("\n【 ① BTS-600 프로그램 입력 시트 】")
    for s in plan["setup_sheet"]:
        print(f"\n  [{s['순서']}] {s['시험']}  →  프로그램: {s['BTS_프로그램']}")
        for line in s["입력방법"]:
            print(f"      {line}")

    print("\n【 ② 완료 예측 & ③ 알람 】")
    print(f"  {'순서':<4}{'시험':<10}{'시작':<18}{'예상완료':<18}{'소요':<14}알람")
    print("  " + "-" * 74)
    for s in plan["schedule"]:
        print(f"  {s['순서']:<4}{s['시험']:<10}{s['시작']:<18}{s['예상완료']:<18}"
              f"{s['소요']:<14}🔔 {s['알람']}")
    print(f"\n  → 각 시험 완료 6시간 전에 '다음 시험 준비' 알람 발송")


if __name__ == "__main__":
    # 예시 계획: GB L6, 샘플 #1·#3, 기본성능 = 만충전→C20→만충전, 이후 수명
    plan = plan_test(
        model="GB L6",
        samples=["#1", "#3"],
        sequence=["만충전", "C20", "만충전", "수명(ISS)"],
        start_str="2025-11-20 09:00",
    )
    print_plan(plan)
    Path("prototype/out/test_plan.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n저장: prototype/out/test_plan.json")
