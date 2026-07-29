#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""수집 결과를 한 화면에 보여준다.

CSV 를 열어 행을 세게 하지 마라.  "몇 건 나왔냐" 는 질문에 도구가 직접
답해야 한다.  뭐가 됐고 뭐가 안 됐고 다음에 뭘 할지까지 찍는다."""
import collections
import csv
import io
import os
import sys
import unicodedata

try:
    sys.stdout.reconfigure(errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CAT = os.path.join(ROOT, 'catalogs')


def rows(name):
    p = os.path.join(CAT, name)
    if not os.path.exists(p):
        return None
    with io.open(p, encoding='utf-8-sig', newline='') as fp:
        return list(csv.DictReader(fp))


def bar(n, top, width=22):
    return '█' * max(1, int(round(n / max(top, 1) * width)))


def pad(text, width):
    """한글은 콘솔에서 두 칸을 차지한다.  len() 으로 맞추면 줄이 어긋난다."""
    w = sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in text)
    while w > width and text:
        text = text[:-1]
        w = sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in text)
    return text + ' ' * (width - w)


def main():
    print()
    print('=' * 58)
    print('   수집 결과 요약')
    print('=' * 58)
    if not os.path.isdir(CAT):
        print('\n  아직 아무것도 없습니다. 실행하기_윈도우.bat 을 먼저 돌리세요.')
        return 1

    # ── 주소 확인(1번) ────────────────────────────────────────────────
    chk = rows('url_check.csv')
    if chk:
        ok = sum(1 for r in chk if r.get('결과') == '열림')
        print('\n[주소 확인]  %d개 중 %d개가 열립니다.' % (len(chk), ok))

    # ── 받은 카달로그 ─────────────────────────────────────────────────
    reg = rows('catalog_registry.csv')
    if reg:
        pages = sum(int(r['페이지수']) for r in reg
                    if (r.get('페이지수') or '').isdigit())
        print('\n[받은 카달로그]  PDF %d개 / 총 %d쪽' % (len(reg), pages))

    # ── 뽑은 스펙 ─────────────────────────────────────────────────────
    mod = rows('collected_models.csv')
    if not mod:
        print('\n[뽑은 스펙]  아직 없습니다.')
        print('\n  실행하기_윈도우.bat -> 2번(전체 수집)을 돌리세요.')
        print('=' * 58)
        return 0

    print('\n[뽑은 스펙]  총 %s건' % format(len(mod), ','))

    conf = collections.Counter()
    for r in mod:
        note = r.get('비고', '')
        for k in ('높음', '보통', '낮음'):
            if '확신도 ' + k in note:
                conf[k] += 1
                break
    if conf:
        print()
        for k, label in (('높음', '높음  용량·CCA 가 다 잡힘 — 거의 그대로 써도 된다'),
                         ('보통', '보통  일부만 잡힘 — 훑어보고 쓴다'),
                         ('낮음', '낮음  숫자 열이 미확정 — 원본 대조 필요')):
            if conf[k]:
                print('   %-4s %5d건  %s' % (k, conf[k], label))

    # 열 미확정 행이 많으면 그게 다음 작업이다
    nums = sum(1 for r in mod if '표 숫자(열 미확정)' in r.get('비고', ''))

    # ── 브랜드별 ──────────────────────────────────────────────────────
    by = collections.Counter(r.get('브랜드', '?') for r in mod)
    if by:
        top = by.most_common(1)[0][1]
        print('\n[브랜드별]')
        for name, n in by.most_common(12):
            print('   %s %5d  %s' % (pad(name, 16), n, bar(n, top)))
        if len(by) > 12:
            print('   ... 그 외 %d개 브랜드' % (len(by) - 12))

    # ── 규격체계별 ────────────────────────────────────────────────────
    std = collections.Counter(r.get('규격체계', '?') or '?' for r in mod)
    if std:
        print('\n[규격체계별]  ' + ' · '.join(
            '%s %d' % (k, v) for k, v in std.most_common()))

    # ── 실패 ──────────────────────────────────────────────────────────
    log = rows('collect_log.csv')
    if log:
        fail = [r for r in log if r.get('상태') == '실패']
        print('\n[주소]  성공 %d · 실패 %d'
              % (sum(1 for r in log if r.get('상태') == '성공'), len(fail)))

    # ── 다음에 할 일 ──────────────────────────────────────────────────
    print()
    print('-' * 58)
    print('  다음에 할 일')
    print()
    print('  1) 실행하기_윈도우.bat -> 6번  (받은 카달로그를 폴더로 정리)')
    print('  2) battery_catalog.html 열기 -> 데이터 관리 -> CSV 가져오기')
    print('     올릴 파일:  catalogs\\collected_models.csv')
    if nums:
        print()
        print('  3) 확신도 낮음 %d건은 숫자 열이 미확정입니다.' % nums)
        print('     비고의 "표 숫자" 를 카달로그 표 머리글과 맞춰보면')
        print('     엑셀에서 한 번에 채울 수 있습니다.')
    print()
    print('  ★ 끝나면 [전체 JSON 백업] 을 내보내기\\ 에 저장하세요.')
    print('=' * 58)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
