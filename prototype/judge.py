#!/usr/bin/env python3
"""
합부 판정 모듈 — 추출값을 규격 기준과 대조해 합/부 자동 판정.

※ 아래 SPEC은 '예시 판정기준'이다. 실제 사내 규격값으로 교체해서 쓴다.
   기준을 바꾸면 판정 로직은 그대로 재사용된다.
"""

from dataclasses import dataclass


# ── 예시 판정기준 (실제 규격으로 교체) ─────────────────────────
# 모델 코드 → 기준. 없으면 DEFAULT 사용.
SPEC = {
    "_DEFAULT": {
        "총방전용량_min": 95.0,      # Ah 이상 (예시)
        "안정화24h_min": 13.0,       # V 이상 (예시)
        "방전종지_target": 10.5,     # V 도달(±0.1) — 설계 컷오프
        "종지허용": 0.1,
    },
}


@dataclass
class Judgment:
    item: str
    value: float
    limit: str
    ok: bool


def judge(model, tracking, analyzer_findings):
    """
    model: 모델 코드(예 'GB L6'), tracking: extract_tracking 결과,
    analyzer_findings: analyze()의 findings 리스트.
    반환: (종합판정 'PASS'/'FAIL'/'HOLD', [Judgment...])
    """
    spec = SPEC.get(model, SPEC["_DEFAULT"])
    js = []

    cap = tracking.get("총방전용량(Ah)", 0.0)
    stabs = tracking.get("안정화전압(휴지종료V)", [])
    stab24 = stabs[1] if len(stabs) > 1 else (stabs[0] if stabs else None)
    curve = tracking.get("SOC구간 OCV(V)", [])
    endv = curve[-1] if curve else None

    # 방전을 수행한 시험만 용량/종지 판정 (비중평가 등은 해당없음)
    did_discharge = cap and cap > 1.0

    # C20 용량시험 판정은 '방전을 수행한' 시료에만 적용.
    # (비중평가 등 다른 경로는 C20 기준으로 판정하지 않음 → N/A)
    if did_discharge:
        ok = cap >= spec["총방전용량_min"]
        js.append(Judgment("총방전용량", round(cap, 3), f"≥ {spec['총방전용량_min']} Ah", ok))
        if endv is not None:
            ok = abs(endv - spec["방전종지_target"]) <= spec["종지허용"]
            js.append(Judgment("방전 종지전압", round(endv, 3),
                               f"= {spec['방전종지_target']}±{spec['종지허용']} V", ok))
        if stab24 is not None:
            ok = stab24 >= spec["안정화24h_min"]
            js.append(Judgment("안정화 전압(24h)", round(stab24, 3),
                               f"≥ {spec['안정화24h_min']} V", ok))

    # 이상 감지에 ALARM 있으면 HOLD
    has_alarm = any(getattr(f, "level", "") == "ALARM" for f in analyzer_findings)

    if not js:
        verdict = "N/A"
    elif has_alarm:
        verdict = "HOLD"      # 판정보류 — 이상 확인 필요
    elif all(j.ok for j in js):
        verdict = "PASS"
    else:
        verdict = "FAIL"
    return verdict, js
