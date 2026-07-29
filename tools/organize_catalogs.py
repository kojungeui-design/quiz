#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""받은 카달로그를 사람이 찾을 수 있는 폴더로 정리한다.

collect.py 는 `catalogs/bosch_in/` 처럼 브랜드마켓 키로 떨군다.  기계는 편한데
사람은 `bosch_in` 이 인도인지 인도네시아인지 모른다.  그래서 받은 파일을
지역 → 브랜드 순으로 다시 깔고, 파일명에 브랜드·마켓·연도를 박는다.

    catalogs/카달로그/
      06_유럽/
        Bosch/  Bosch_유럽_2017_batteries_s3s4s5_2pp.pdf
        Exide/  Exide_유럽_TechnicalGuide_Edition5.pdf
      05_인도/
        Bosch/  Bosch_인도_2023_battery_catalogue.pdf
      _목록.csv       ← 어느 파일이 무슨 카달로그인지 (엑셀로 열림)
      _목록.html      ← 더블클릭하면 클릭으로 열리는 목록

원본은 그대로 두고 복사한다.  다시 돌려도 안전하다.

    python3 tools/organize_catalogs.py
    python3 tools/organize_catalogs.py --move     # 복사 대신 옮기기
"""
import argparse
import csv
import hashlib
import io
import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 지역 정렬용 번호 — 탐색기에서 우리가 보는 순서대로 서게 한다.
REGION_ORDER = ['한국', '일본', '중화권', '동남아', '인도', '유럽',
                '북미', '중남미', '중동·아프리카', '오세아니아', '기타']
OUT_COLS = ['지역', '브랜드', '제조사', '마켓', '파일명', '쪽수', 'SHA256',
            '받은날짜', '원본URL', '폴더']


def slug(s):
    """윈도우 폴더명으로 못 쓰는 글자를 걷어낸다."""
    s = re.sub(r'[\\/:*?"<>|]+', '_', (s or '').strip())
    return re.sub(r'\s+', ' ', s).strip(' .') or '기타'


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fp:
        for chunk in iter(lambda: fp.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_sources(path):
    """브랜드마켓 키 → (브랜드, 제조사, 마켓) 을 만든다."""
    m = {}
    if not os.path.exists(path):
        return m
    with io.open(path, encoding='utf-8-sig') as fp:
        for r in csv.DictReader(fp):
            m.setdefault(r['브랜드마켓'],
                         (r['브랜드'], r['제조사'], r['마켓']))
    return m


def region_of(market):
    """마켓 이름에서 우리 지역 구분을 찾는다."""
    t = market or ''
    for key, rg in (('한국', '한국'), ('일본', '일본'), ('중국', '중화권'),
                    ('대만', '중화권'), ('동남아', '동남아'), ('말레이', '동남아'),
                    ('베트남', '동남아'), ('태국', '동남아'), ('인도네시아', '동남아'),
                    ('인도', '인도'), ('유럽', '유럽'), ('그리스', '유럽'),
                    ('영국', '유럽'), ('독일', '유럽'), ('북미', '북미'),
                    ('미국', '북미'), ('중남미', '중남미'), ('브라질', '중남미'),
                    ('멕시코', '중남미'), ('중동', '중동·아프리카'),
                    ('사우디', '중동·아프리카'), ('아프리카', '중동·아프리카'),
                    ('터키', '중동·아프리카'), ('남아공', '중동·아프리카'),
                    ('방글라데시', '인도'), ('오세아니아', '오세아니아'),
                    ('호주', '오세아니아'), ('뉴질랜드', '오세아니아')):
        if key in t:
            return rg
    return '기타'


def registry_index(path):
    """catalog_registry.csv 에서 파일별 쪽수·해시·URL·수집일을 끌어온다."""
    idx = {}
    if not os.path.exists(path):
        return idx
    with io.open(path, encoding='utf-8-sig') as fp:
        for r in csv.DictReader(fp):
            rel = (r.get('파일명') or '').replace('\\', '/')
            if rel:
                idx[os.path.basename(rel)] = r
    return idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.join(ROOT, 'catalogs'))
    ap.add_argument('--out', default=None, help='기본: <src>/카달로그')
    ap.add_argument('--move', action='store_true', help='복사 대신 옮긴다')
    args = ap.parse_args()

    src_dir = args.src
    out_dir = args.out or os.path.join(src_dir, '카달로그')
    if not os.path.isdir(src_dir):
        print('[X] %s 폴더가 없습니다. collect.py 를 먼저 돌리세요.' % src_dir)
        return 1

    sources = load_sources(os.path.join(ROOT, 'data', 'catalog_sources.csv'))
    reg = registry_index(os.path.join(src_dir, 'catalog_registry.csv'))

    rows, n_pdf, n_html = [], 0, 0
    for bm in sorted(os.listdir(src_dir)):
        sub = os.path.join(src_dir, bm)
        # 정리 결과 폴더와 CSV 는 건너뛴다
        if not os.path.isdir(sub) or bm == os.path.basename(out_dir):
            continue
        brand, maker, market = sources.get(bm, (bm, '', ''))
        region = region_of(market)
        rank = REGION_ORDER.index(region) if region in REGION_ORDER else 99
        dest_dir = os.path.join(out_dir, '%02d_%s' % (rank + 1, slug(region)),
                                slug(brand))

        for name in sorted(os.listdir(sub)):
            path = os.path.join(sub, name)
            if not os.path.isfile(path):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext not in ('.pdf', '.html', '.htm'):
                continue

            meta = reg.get(name, {})
            base = os.path.splitext(name)[0]
            # 연도를 앞으로 끌어내 정렬되게 한다.  이름에 이미 있으면 옮기기만
            # 하고 덧붙이지 않는다 — 안 그러면 catalogue_2023 이
            # 2023_catalogue_2023 이 된다.
            m = re.search(r'(20[0-2]\d)', base)
            year = ''
            if m:
                year = m.group(1) + '_'
                base = (base[:m.start()] + base[m.end():]).strip('_-. ')
            newname = '%s_%s_%s%s%s' % (slug(brand), slug(market or bm),
                                        year, base[:70], ext)
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, newname)
            if os.path.abspath(dest) != os.path.abspath(path):
                (shutil.move if args.move else shutil.copy2)(path, dest)

            rows.append([region, brand, maker, market, newname,
                         meta.get('페이지수', ''),
                         meta.get('SHA256', '') or sha256(dest),
                         meta.get('수집일', ''), meta.get('PDF_URL', ''),
                         os.path.relpath(dest_dir, out_dir)])
            if ext == '.pdf':
                n_pdf += 1
            else:
                n_html += 1

    if not rows:
        print('[X] 정리할 파일이 없습니다. collect.py 가 아직 아무것도 못 받았습니다.')
        return 1

    os.makedirs(out_dir, exist_ok=True)
    rows.sort(key=lambda r: (REGION_ORDER.index(r[0]) if r[0] in REGION_ORDER
                             else 99, r[1], r[4]))

    # 엑셀에서 바로 열리게 BOM + CRLF 로 쓴다.
    with io.open(os.path.join(out_dir, '_목록.csv'), 'w',
                 encoding='utf-8-sig', newline='') as fp:
        w = csv.writer(fp, lineterminator='\r\n')
        w.writerow(OUT_COLS)
        w.writerows(rows)

    esc = lambda s: (str(s).replace('&', '&amp;').replace('<', '&lt;')
                     .replace('>', '&gt;').replace('"', '&quot;'))
    html = ['<!doctype html><meta charset="utf-8">',
            '<title>받은 카달로그 목록</title>',
            '<style>body{font:14px/1.6 -apple-system,"Malgun Gothic",sans-serif;'
            'margin:24px;max-width:1100px}h1{font-size:19px}'
            'table{border-collapse:collapse;width:100%}'
            'th,td{border-bottom:1px solid #ddd;padding:6px 9px;text-align:left}'
            'th{background:#f4f6f8}a{color:#1558d6}'
            'tr:hover td{background:#fafbfc}</style>',
            '<h1>받은 카달로그 %d건 <small>(PDF %d · 페이지 %d)</small></h1>'
            % (len(rows), n_pdf, n_html),
            '<table><tr><th>지역<th>브랜드<th>마켓<th>파일<th>쪽<th>받은날<th>원본']
    for r in rows:
        link = os.path.join(r[9], r[4]).replace('\\', '/')
        html.append('<tr><td>%s<td>%s<td>%s<td><a href="%s">%s</a><td>%s<td>%s'
                    '<td>%s' % (esc(r[0]), esc(r[1]), esc(r[3]), esc(link),
                                esc(r[4]), esc(r[5]), esc(r[7]),
                                ('<a href="%s">원본</a>' % esc(r[8])) if r[8] else ''))
    html.append('</table>')
    with io.open(os.path.join(out_dir, '_목록.html'), 'w', encoding='utf-8') as fp:
        fp.write('\n'.join(html))

    print()
    print('=' * 52)
    print('  카달로그 %d건을 정리했습니다. (PDF %d · 페이지 %d)' % (len(rows), n_pdf, n_html))
    print()
    seen = []
    for r in rows:
        if r[0] not in seen:
            seen.append(r[0])
    for rg in seen:
        brands = sorted(set(r[1] for r in rows if r[0] == rg))
        print('    %-14s %2d건  %s' % (rg, sum(1 for r in rows if r[0] == rg),
                                       ', '.join(brands[:6])))
    print()
    print('  폴더:   %s' % out_dir)
    print('  목록:   _목록.csv  (엑셀)   /   _목록.html  (더블클릭)')
    print('=' * 52)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
