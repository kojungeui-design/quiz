#!/usr/bin/env python3
"""
시험 완료 감지기 — 스크린샷으로 읽은 Status 스냅샷 2개를 비교해
'진행 중 → STO' 로 바뀐 회로(=방금 완료된 시험)를 찾아낸다.

역할 분담:
  - 스크린샷(이 감지기): 완료 '감지'만. 정밀도 불필요(상태 글자만).
  - 진짜 Export: 완료된 회로만 export → 실제 정밀 데이터 → 관리대장/성적서.

상태: CHA(충전)·DCH(방전)·PAU(휴지)=진행중,  STO=정지/완료
"""

RUNNING = {"CHA", "DCH", "PAU"}
DONE = "STO"


def detect_completions(prev, curr):
    """
    prev, curr: {회로: 상태}  (직전 스냅샷, 현재 스냅샷)
    반환: 이번에 '진행중 → STO'로 바뀐 회로 리스트 (= 방금 완료)
    """
    done = []
    for circ, now in curr.items():
        before = prev.get(circ)
        if before in RUNNING and now == DONE:
            done.append(circ)
    return done


def summarize(prev, curr):
    done = detect_completions(prev, curr)
    running = [c for c, s in curr.items() if s in RUNNING]
    idle = [c for c, s in curr.items() if s == DONE and prev.get(c) == DONE]
    return {
        "완료(신규)": done,      # → 이 회로들만 진짜 Export 실행
        "진행중": running,
        "정지(계속)": idle,      # 원래 STO였던 것 — 무시
    }


if __name__ == "__main__":
    # 데모: 1시간 간격 두 스냅샷 비교
    prev = {  # 직전 스크린샷
        "Circ0007": "CHA", "Circ0008": "CHA", "Circ0023": "DCH",
        "Circ0024": "DCH", "Circ0035": "CHA", "Circ0100": "STO",
    }
    curr = {  # 1시간 뒤 스크린샷
        "Circ0007": "CHA",           # 계속 충전 중
        "Circ0008": "STO",           # ← 완료! (CHA→STO)
        "Circ0023": "PAU",           # 휴지로 전환(진행중)
        "Circ0024": "STO",           # ← 완료! (DCH→STO)
        "Circ0035": "CHA",           # 계속 진행
        "Circ0100": "STO",           # 원래 STO (무시)
    }
    r = summarize(prev, curr)
    print("=" * 56)
    print("  시험 완료 감지 (스크린샷 2장 비교)")
    print("=" * 56)
    print(f"  ✅ 방금 완료 → 이 회로만 Export: {r['완료(신규)']}")
    print(f"  ▶  진행 중: {r['진행중']}")
    print(f"  ⏹  정지(계속, 무시): {r['정지(계속)']}")
    print("\n  → Circ0008, Circ0024 만 진짜 Export → 관리대장·성적서 자동 처리")
