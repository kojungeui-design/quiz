#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""제조사 카달로그(PDF) 수집기.  근거를 남기려고 만든 것.

하는 일
  1. data/catalog_sources.csv 의 URL 을 돈다.
  2. 직접 PDF 링크면 받고, 카달로그 페이지면 그 안의 .pdf 링크를 찾아서 받는다.
  3. catalogs/<제조사키>/<파일명> 으로 저장하고
     파일별 SHA-256 · 크기 · 페이지수 · 수집일시 · 원본 URL 을 기록한다.
  4. catalog_registry.csv 를 만든다.  battery_catalog.html 의
     [데이터 관리 → 카달로그 원본(PDF) 근거 등록] 에 그대로 올리면 된다.

주의
  - 받은 PDF 는 제조사 저작물이다.  이 저장소는 공개 저장소이므로
    catalogs/ 는 .gitignore 에 넣어두었다.  사내에 보관할 것.
  - 판(edition)/발행연도는 자동으로 알 수 없다.  PDF 제목·표지에서 읽히면
    채워주고, 안 되면 비워둔다.  받은 뒤 사람이 확인해서 채우는 칸이다.

사용법
    pip install requests
    python3 tools/fetch_catalogs.py                     # 전체
    python3 tools/fetch_catalogs.py --only clarios exide
    python3 tools/fetch_catalogs.py --out catalogs --csv catalog_registry.csv
"""
import argparse
import csv
import datetime
import hashlib
import os
import re
import sys
import urllib.parse

try:
    import requests
except ImportError:  # pragma: no cover
    sys.exit("requests 가 필요하다:  pip install requests")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCES = os.path.join(ROOT, 'data', 'catalog_sources.csv')
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
PDF_RE = re.compile(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', re.I)
REGISTRY_COLS = ['제조사키', '제조사', '카달로그명', '판', '발행연도', 'PDF_URL',
                 '파일명', 'SHA256', '페이지수', '수집일', '상태', '비고']


def safe_name(url, fallback):
    name = os.path.basename(urllib.parse.urlparse(url).path) or fallback
    name = urllib.parse.unquote(name)
    name = re.sub(r'[^\w.\-가-힣]+', '_', name)
    return (name if name.lower().endswith('.pdf') else name + '.pdf')[:120]


def pdf_pages(path):
    """의존성 없이 페이지 수만 대충 센다. 실패하면 빈 값."""
    try:
        with open(path, 'rb') as fp:
            blob = fp.read()
        counts = len(re.findall(rb'/Type\s*/Page[^s]', blob))
        if counts:
            return counts
        m = re.findall(rb'/Count\s+(\d+)', blob)
        return max(int(x) for x in m) if m else ''
    except Exception:
        return ''


def pdf_title(path):
    try:
        with open(path, 'rb') as fp:
            blob = fp.read(400000)
        m = re.search(rb'/Title\s*\(([^)]{2,120})\)', blob)
        if m:
            return m.group(1).decode('utf-8', 'ignore').strip()
    except Exception:
        pass
    return ''


def guess_year(*texts):
    for t in texts:
        m = re.search(r'(20[12]\d)', t or '')
        if m:
            return m.group(1)
    return ''


def fetch(session, url, dest):
    r = session.get(url, timeout=60, allow_redirects=True)
    r.raise_for_status()
    ctype = r.headers.get('content-type', '')
    if 'pdf' not in ctype.lower() and not r.content[:5].startswith(b'%PDF'):
        return None, ctype
    with open(dest, 'wb') as fp:
        fp.write(r.content)
    return r.content, ctype


def find_pdf_links(session, page_url, pattern):
    r = session.get(page_url, timeout=60)
    r.raise_for_status()
    links = []
    for href in PDF_RE.findall(r.text):
        full = urllib.parse.urljoin(page_url, href)
        if pattern and not re.search(pattern, full, re.I):
            continue
        if full not in links:
            links.append(full)
    return links


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sources', default=SOURCES)
    ap.add_argument('--out', default=os.path.join(ROOT, 'catalogs'))
    ap.add_argument('--csv', default=os.path.join(ROOT, 'catalogs', 'catalog_registry.csv'))
    ap.add_argument('--only', nargs='*', help='제조사키만 골라서')
    ap.add_argument('--max-per-source', type=int, default=6)
    args = ap.parse_args()

    with open(args.sources, encoding='utf-8-sig') as fp:
        rows = list(csv.DictReader(fp))
    if args.only:
        rows = [r for r in rows if r['제조사키'] in args.only]

    session = requests.Session()
    session.headers.update({'User-Agent': UA, 'Accept': '*/*'})
    today = datetime.date.today().isoformat()
    out_rows, ok, fail = [], 0, 0

    for row in rows:
        key, name, url = row['제조사키'], row['제조사'], row['URL'].strip()
        kind = (row.get('유형') or '').strip().lower()
        if not url:
            out_rows.append([key, name, row.get('카달로그명', ''), '', '', '', '', '', '', today,
                             '미수집', 'URL 없음 — 사이트에서 직접 찾아야 함'])
            continue
        folder = os.path.join(args.out, key)
        os.makedirs(folder, exist_ok=True)
        try:
            targets = [url] if kind == 'pdf' else find_pdf_links(session, url, row.get('필터'))
        except Exception as exc:
            fail += 1
            print('  [페이지 실패] %-12s %s' % (key, exc))
            out_rows.append([key, name, row.get('카달로그명', ''), '', '', url, '', '', '', today,
                             '실패', str(exc)[:120]])
            continue
        if not targets:
            print('  [PDF 없음]   %-12s %s' % (key, url))
            out_rows.append([key, name, row.get('카달로그명', ''), '', '', url, '', '', '', today,
                             '미수집', '페이지에서 PDF 링크를 못 찾음'])
            continue

        for target in targets[:args.max_per_source]:
            dest = os.path.join(folder, safe_name(target, key))
            try:
                blob, ctype = fetch(session, target, dest)
            except Exception as exc:
                fail += 1
                print('  [실패]       %-12s %s' % (key, exc))
                out_rows.append([key, name, row.get('카달로그명', ''), '', '', target, '', '', '',
                                 today, '실패', str(exc)[:120]])
                continue
            if blob is None:
                print('  [PDF 아님]   %-12s %s' % (key, ctype))
                out_rows.append([key, name, row.get('카달로그명', ''), '', '', target, '', '', '',
                                 today, '실패', 'PDF 가 아님 (%s)' % ctype[:40]])
                continue
            sha = hashlib.sha256(blob).hexdigest()
            title = pdf_title(dest)
            out_rows.append([
                key, name, title or row.get('카달로그명', ''), row.get('판', ''),
                guess_year(title, target), target, os.path.relpath(dest, ROOT), sha,
                pdf_pages(dest), today, '수집완료',
                '%.1f MB' % (len(blob) / 1048576.0)])
            ok += 1
            print('  [받음]       %-12s %-52s %s' % (key, os.path.basename(dest), sha[:12]))

    os.makedirs(os.path.dirname(args.csv), exist_ok=True)
    with open(args.csv, 'w', encoding='utf-8-sig', newline='') as fp:
        w = csv.writer(fp)
        w.writerow(REGISTRY_COLS)
        w.writerows(out_rows)
    print('\n성공 %d건 / 실패 %d건 → %s' % (ok, fail, args.csv))
    print('판(edition)·발행연도는 자동으로 안 잡히는 경우가 많다. CSV 를 열어 채운 뒤 앱에 올릴 것.')


if __name__ == '__main__':
    main()
