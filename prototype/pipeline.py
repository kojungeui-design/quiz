#!/usr/bin/env python3
"""
통합 파이프라인 — 폴더에 쌓인 BTS-600 CSV를 '한 번에' 처리.

    python3 pipeline.py <csv폴더> [모델코드]

각 파일에 대해:  파싱 → 관리대장 값 추출 → 이상 감지 → 합부 판정
전체에 대해:     주간 시험현황 요약(JSON+콘솔) 생성
'run 4 scripts'를 'drop files → one command'로 바꾼다.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from bts600_extract import parse, extract_tracking
from bts600_analyzer import parse as aparse, analyze
from judge import judge


def process_one(csv_path, model):
    meta, steps = parse(csv_path)
    tracking = extract_tracking(meta, steps)
    ameta, arows = aparse(csv_path)
    findings, summary = analyze(ameta, arows)
    verdict, judgments = judge(model, tracking, findings)

    notable = [f"[{f.level}] {f.message}" for f in findings if f.level in ("ALARM", "WARN")]
    return {
        "file": Path(csv_path).name,
        "battery": tracking["시료"],
        "circuit": tracking["회로"],
        "section": tracking["시험구간"],
        "program": tracking["프로그램"],
        "running": summary.get("running"),
        "duration_h": summary.get("duration_h"),
        "logs": summary.get("rows"),
        "총방전용량": tracking["총방전용량(Ah)"],
        "안정화전압": tracking["안정화전압(휴지종료V)"],
        "verdict": verdict,
        "judgments": [{"item": j.item, "value": j.value, "limit": j.limit, "ok": j.ok}
                      for j in judgments],
        "notable": notable,
    }


VBADGE = {"PASS": "✅ 합격", "FAIL": "❌ 불합격", "HOLD": "⏸ 판정보류",
          "N/A": "— 해당없음"}


def main(folder, model="GB L6"):
    csvs = sorted(Path(folder).glob("*.csv"))
    if not csvs:
        print(f"CSV 없음: {folder}")
        return
    results = [process_one(str(c), model) for c in csvs]

    print("=" * 82)
    print(f"  주간 시험현황 리포트  |  모델 {model}  |  {len(results)}개 시험 자동 처리")
    print("=" * 82)
    print(f"{'시료':<10}{'시험':<10}{'상태':<8}{'경과h':>7}{'방전용량':>9}  판정")
    print("-" * 82)
    for r in results:
        state = "진행중" if r["running"] else "종료"
        cap = f"{r['총방전용량']:.1f}" if r["총방전용량"] else "-"
        print(f"{r['battery']:<10}{r['section']:<10}{state:<8}"
              f"{r['duration_h']:>7.1f}{cap:>9}  {VBADGE[r['verdict']]}")
        for n in r["notable"]:
            print(f"           └ {n[:66]}")

    # 요약 집계
    n_pass = sum(1 for r in results if r["verdict"] == "PASS")
    n_hold = sum(1 for r in results if r["verdict"] == "HOLD")
    n_warn = sum(1 for r in results if r["notable"])
    print("-" * 82)
    print(f"합격 {n_pass} · 판정보류 {n_hold} · 이상감지 {n_warn}건 · 총 로그 "
          f"{sum(r['logs'] for r in results):,}")

    out = Path("prototype/out/weekly_status.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n저장: {out}")
    return results


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else "prototype/samples"
    model = sys.argv[2] if len(sys.argv) > 2 else "GB L6"
    main(folder, model)
