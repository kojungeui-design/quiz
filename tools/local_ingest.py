#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""이미 갖고 있는 카달로그 파일에서 스펙을 뽑는다.

collect.py 는 인터넷에서 받아온다.  그런데 사내에 이미 모아둔 카달로그가
있으면 그게 더 낫다 — 받아지지도 않는 주소(404)를 대신하고, 영업이 직접
받아온 최신판인 경우가 많다.

    python3 tools/local_ingest.py                 # 기본: <폴더>/사내자료
    python3 tools/local_ingest.py "D:\\경로\\자료"
    python3 tools/local_ingest.py --brand Banner  # 브랜드를 못 알아보면 지정

PDF 와 엑셀(xlsx) 을 둘 다 읽는다.  엑셀은 열 제목(`품번 | 규격 | C20 | CCA`)을
읽어 열을 짚는다 — 정규식으로 긁는 것보다 훨씬 정확하다.  PDF 는 표에 제목이
없으니 collect.py 와 같은 방식으로 훑는다.

결과는 catalogs/local_models.csv 와 catalogs/local_registry.csv 다.
원본 파일은 건드리지 않는다.  사내자료라 저장소에 커밋하면 안 된다."""
import argparse
import collections
import csv
import hashlib
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collect import (BRAND_DICT, MODEL_COLS, REGISTRY_COLS,  # noqa: E402
                     find_bci, find_size, parse_specs, pdf_pages, pdf_text)

try:
    sys.stdout.reconfigure(errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fp:
        for chunk in iter(lambda: fp.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def guess_brand(name):
    """파일명에서 브랜드를 알아낸다.  긴 이름부터 봐야 GS 가 GS Yuasa 를 안 먹는다."""
    low = name.lower()
    for b in sorted(BRAND_DICT, key=len, reverse=True):
        if b.lower() in low:
            return b
    return ''


# 엑셀은 열 제목이 있다.  정규식으로 긁을 게 아니라 제목을 읽어 열을 짚는다.
# 사내 자료는 대개 `품번 | 규격 | C20 | CCA(EN) | 무게` 꼴이라 이게 훨씬 정확하다.
HEAD_KEYS = [
    ('size',  ['규격', '사이즈', '타입', 'size', 'type', '그룹', 'group',
               'din', 'bci', 'jis', 'etn', '형식']),
    ('model', ['품번', '품목', '부품', '모델', '형명', '제품', 'model', 'part',
               'code', 'item']),
    ('ah',    ['c20', '20hr', '20시간', '용량', 'capacity', 'ah', '정격']),
    ('cca',   ['cca', 'cranking', '냉시동', '시동전류', 'sae', ' en', 'en)', '(en']),
    ('rc',    ['rc', '보유', 'reserve']),
    ('wt',    ['무게', '중량', 'weight', 'kg']),
    ('tech',  ['기술', 'tech', '타입구분', 'agm', 'efb']),
]
SANE = {'ah': (10, 300), 'cca': (100, 2000), 'rc': (10, 700), 'wt': (2, 80)}


def _num(v):
    try:
        return float(str(v).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def _map_header(cells):
    """제목 줄이면 {필드: 열번호} 를 준다.  아니면 None."""
    col = {}
    for i, c in enumerate(cells):
        t = str(c or '').strip().lower()
        if not t or len(t) > 24:
            continue
        for field, keys in HEAD_KEYS:
            if field in col:
                continue
            if any(k in t for k in keys):
                col[field] = i
                break
    # 규격이나 품번이 있고 수치 열이 하나라도 있어야 제목 줄로 본다
    if (('size' in col or 'model' in col)
            and any(f in col for f in ('ah', 'cca', 'rc'))):
        return col
    return None


def xlsx_specs(path):
    """엑셀에서 열 제목을 읽어 스펙을 뽑는다."""
    try:
        import openpyxl
    except ImportError:
        print('   (엑셀을 읽으려면:  pip install openpyxl)')
        return [], 0
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:
        print('   (열지 못함: %s)' % str(exc)[:60])
        return [], 0

    out, nrow = [], 0
    for ws in wb.worksheets:
        col = None
        for row in ws.iter_rows(values_only=True):
            cells = list(row)
            nrow += 1
            if col is None:
                col = _map_header(cells)
                continue
            get = lambda f: (cells[col[f]] if f in col and col[f] < len(cells)
                             else None)
            size = str(get('size') or '').strip()
            model = str(get('model') or '').strip()
            if not size and not model:
                continue
            vals = {}
            for f in ('ah', 'cca', 'rc', 'wt'):
                v = _num(get(f))
                lo, hi = SANE[f]
                vals[f] = v if v is not None and lo <= v <= hi else ''
            if not size:
                # 품번에서 규격을 뽑아본다 (75D23L, LN3, 24F-525B)
                size, _std = find_size(model)
                if not size:
                    size = find_bci(model, strong=bool(vals['ah'] and vals['cca']))
            if not size or not (vals['ah'] or vals['cca']):
                continue
            _s, std = find_size(size)
            tech = ''
            t = str(get('tech') or '').upper()
            for k in ('AGM', 'EFB'):
                if k in t or k in model.upper():
                    tech = k
            out.append({
                'size': (_s or size)[:20], 'std': std or '',
                'ah': int(vals['ah']) if vals['ah'] else '',
                'cca': int(vals['cca']) if vals['cca'] else '', 'ccaStd': '',
                'dim': '', 'v': '12', 'tech': tech, 'nums': '',
                'conf': '높음' if (vals['ah'] and vals['cca']) else '보통',
                'raw': ' | '.join(str(c) for c in cells[:8] if c is not None)[:160],
            })
    wb.close()
    return out, nrow


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder', nargs='?', default=os.path.join(ROOT, '사내자료'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'catalogs'))
    ap.add_argument('--brand', default='', help='파일명으로 브랜드를 못 알아볼 때')
    ap.add_argument('--loose', action='store_true')
    args = ap.parse_args()

    if not os.path.isdir(args.folder):
        print('\n[X] 폴더가 없습니다: %s' % args.folder)
        print('    카달로그 파일을 모아둔 폴더 경로를 넣어 주세요.')
        return 1

    files = []
    for root, _dirs, names in os.walk(args.folder):
        for n in sorted(names):
            if os.path.splitext(n)[1].lower() in ('.pdf', '.xlsx', '.xlsm'):
                files.append(os.path.join(root, n))
    if not files:
        print('\n[X] %s 안에 PDF·엑셀이 없습니다.' % args.folder)
        return 1

    print()
    print('=' * 58)
    print('   사내 카달로그 읽기 — 파일 %d개' % len(files))
    print('=' * 58)
    print()

    models, registry, seen = [], [], set()
    today = __import__('datetime').date.today().isoformat()

    for path in files:
        name = os.path.basename(path)
        ext = os.path.splitext(name)[1].lower()
        brand = args.brand or guess_brand(name)

        if ext == '.pdf':
            text = pdf_text(path)
            pages = pdf_pages(path)
            if not text:
                print('  [PDF]  %-44s 본문 추출 실패 (이미지 PDF 로 보임)'
                      % name[:44])
                registry.append(['', brand, name, '', '', '', name,
                                 sha256(path), pages, today, '본문없음',
                                 '스캔 이미지라 글자를 못 뽑음'])
                continue
            found = parse_specs(text, loose=args.loose)
            print('  [PDF]  %-44s %5s쪽  스펙 %d건' % (name[:44], pages, len(found)))
            registry.append(['', brand, name, '', '', '', name, sha256(path),
                             pages, today, '수집완료', '스펙 %d건' % len(found)])
        else:
            found, nrow = xlsx_specs(path)
            print('  [XLS]  %-44s %5d행  스펙 %d건' % (name[:44], nrow, len(found)))
            registry.append(['', brand, name, '', '', '', name, sha256(path),
                             '', today, '수집완료', '%d행 / 스펙 %d건'
                             % (nrow, len(found))])

        for f in found:
            key = (brand, f['size'], f['ah'], f['cca'], f['nums'])
            if key in seen:
                continue
            seen.add(key)
            tech = {'AGM': 'AGM', 'EFB': 'EFB'}.get(f['tech'], 'FLD')
            models.append([
                '타사', '', brand or '(미상)',
                '%s %s' % (brand or '?', f['size']), f['size'], f['std'],
                tech, '승용SLI', f['v'], f['ah'], '',
                f['cca'] if f['ccaStd'] != 'EN' else '',
                f['cca'] if f['ccaStd'] == 'EN' else '',
                '', '수집(사내자료)', name, '', path,
                '확신도 %s%s / %s' % (
                    f['conf'],
                    (' / 표 숫자(열 미확정) ' + f['nums']) if f['nums'] else '',
                    f['raw'])])

    os.makedirs(args.out, exist_ok=True)
    for fname, cols, rows_ in (('local_models.csv', MODEL_COLS, models),
                               ('local_registry.csv', REGISTRY_COLS, registry)):
        with io.open(os.path.join(args.out, fname), 'w',
                     encoding='utf-8-sig', newline='') as fp:
            w = csv.writer(fp, lineterminator='\r\n')
            w.writerow(cols)
            w.writerows(rows_)

    by = collections.Counter(m[2] for m in models)
    print()
    print('=' * 58)
    print('  스펙 %s건을 뽑았습니다.' % format(len(models), ','))
    if by:
        print()
        for b, n in by.most_common(15):
            print('   %-18s %5d' % (b[:18], n))
    print()
    print('  올릴 파일:  catalogs\\local_models.csv')
    print('  앱 -> 데이터 관리 -> CSV 가져오기')
    print()
    print('  ※ 사내자료는 저장소에 올리지 마세요.')
    print('=' * 58)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
