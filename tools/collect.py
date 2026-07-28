#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""카탈로그 수집기 — data/catalog_sources.csv 를 돌면서 DB 를 끌어온다.

fetch_catalogs.py 가 PDF 만 받았다면 이건 네 가지를 다 훑는다.

    pdf          PDF 를 받아 해시·페이지수를 남기고 본문에서 스펙을 뽑는다
    productlist  제품 목록 HTML 을 받아 스펙을 뽑고 하위 제품 링크도 따라간다
    sitemap      sitemap.xml 에서 제품 URL 을 발굴해 productlist 처럼 처리
    pattern      URL 의 {변수} 를 값 목록으로 펼쳐 하나씩 받는다
                 (예: delkor.com/products/product-details/{code})

뽑는 것: 규격코드(ETN·DIN·BCI·JIS·LN) / 용량(Ah) / CCA / 치수 / 전압.
자동 파싱은 완벽할 수 없어서 확신도(conf)를 같이 남긴다.  낮은 건 사람이 본다.

결과
    catalogs/<브랜드마켓>/…            받은 원본 파일
    catalogs/catalog_registry.csv      근거 (파일·판·SHA-256·페이지수·수집일)
    catalogs/collected_models.csv      앱 [데이터 관리 → CSV 가져오기] 용 스펙
    catalogs/collect_log.csv           URL 별 성공·실패·추출 건수
    catalogs/url_check.csv             --check 결과 (주소별 응답코드·열림/막힘)

사용법
    pip install requests pypdf
    python3 tools/collect.py                          # 전체
    python3 tools/collect.py --only bosch_na bosch_in # 브랜드마켓만
    python3 tools/collect.py --types pdf productlist  # 유형만
    python3 tools/collect.py --dry                    # URL 만 펼쳐 보기
    python3 tools/collect.py --check                  # 받지 않고 몇 개나 열리는지만

이 저장소는 공개다.  받은 원본과 결과 CSV 는 catalogs/ 아래에 떨어지고
.gitignore 로 막아뒀다.  커밋하지 말 것.
"""
import argparse
import csv
import datetime
import hashlib
import itertools
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
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')

REGISTRY_COLS = ['제조사키', '제조사', '카달로그명', '판', '발행연도', 'PDF_URL',
                 '파일명', 'SHA256', '페이지수', '수집일', '상태', '비고']
MODEL_COLS = ['구분', '제조사', '브랜드', '모델', '규격그룹', '규격체계', '기술', '용도',
              '전압', 'C20용량', 'RC분', 'CCA_SAE', 'CCA_EN', '판매지역', '검증상태',
              '근거문서', '근거페이지', '출처', '비고']
LOG_COLS = ['브랜드마켓', '유형', 'URL', '상태', '추출건수', '비고']
BRAND_COLS = ['유통사', '국가', '지역', '브랜드', '근거 URL', '확인일']

# 유통사 페이지에서 찾을 배터리 브랜드.  바이어(유통사)는 우리 것만 팔지 않는다.
# 그 사이트에 어떤 브랜드가 같이 올라와 있는지가 곧 그 나라 경쟁 구도다.
BRAND_DICT = [
    'VARTA', 'Bosch', 'Exide', 'Tudor', 'Centra', 'Fulmen', 'DETA', 'Sonnenschein',
    'Yuasa', 'GS Yuasa', 'Maxx Yuasa', 'Century', 'Besco', 'Katana', 'Enersun',
    'Optima', 'Odyssey', 'Hawker', 'NorthStar', 'Deka', 'Duracell', 'Duralast',
    'DieHard', 'EverStart', 'ACDelco', 'AC Delco', 'Interstate', 'NAPA', 'Super Start',
    'Banner', 'MOLL', 'FIAMM', 'Monbat', 'Midac', 'Rombat', 'TAB', 'Topla', 'Sznajder',
    'Hoppecke', 'Numax', 'Powerline', 'Westco', 'Lucas', 'MK Battery', 'Trojan',
    'Amaron', 'SF Sonic', 'Livguard', 'Tata Green', 'Camel', 'Fengfan', 'Leoch', 'Wanli',
    'Rocket', 'Delkor', 'Solite', 'Atlas', 'AtlasBX', 'Marshall', 'Global Battery',
    'Moura', 'Heliar', 'LTH', 'Zetta', 'Mutlu', 'İnci', 'Inci', 'Yigit', 'Sabat',
    'Willard', 'Chloride', 'MARIBAT', 'Assad', 'SuperCharge', 'Motolite', 'PINACO',
    '3K', 'GS Astra', 'Lion', 'Intelepower', 'Vision', 'Ritar', 'CSB', 'Narada',
]

# ── 스펙 인식 ────────────────────────────────────────────────────────────
# 규격코드는 체계마다 생김새가 달라서 따로 잡는다.
PAT = {
    'ETN':  re.compile(r'\b([5-7])\s?(\d{2})\s?(\d{3})\s?(\d{3})\b'),      # 560 408 054
    'DIN':  re.compile(r'\b([5-7]\d{4})\b'),                                # 56219 / 60038
    'JIS':  re.compile(r'\b(\d{2,3}[BD]\d{2}[LR]?)\b', re.I),               # 115D31R
    'ISS':  re.compile(r'\b([KMNQST]-\d{2,3})\b'),                          # Q-85 / M-42
    'LN':   re.compile(r'\b(LBN[1-4]|LN[0-6])\b', re.I),                    # LN3 / LBN2
    'L2':   re.compile(r'\b(L[1-6]-\d{3})\b', re.I),                        # L2-400
    'BCI':  re.compile(r'\bgroup\s*(?:size\s*)?(\d{2,3}[RF]?|H[3-9])\b', re.I),
}
AH_RE   = re.compile(r'(\d{2,3})\s*Ah\b', re.I)
# 'A' 뒤에 글자가 오면 Ah 같은 다른 단위다.  그걸 CCA 로 읽던 버그가 있었다.
CCA_RE  = re.compile(r'(?:CCA|cold\s*crank\w*)\s*[:\-]?\s*(\d{3,4})'
                     r'|(\d{3,4})\s*A(?![a-z])\s*\(?(EN|SAE|DIN)?\)?', re.I)
DIM_RE  = re.compile(r'(\d{3})\s*[x×*]\s*(\d{2,3})\s*[x×*]\s*(\d{2,3})')
VOLT_RE = re.compile(r'\b(6|12)\s*V\b', re.I)
TECH_RE = re.compile(r'\b(AGM|EFB|GEL|SLI|MF)\b', re.I)


def find_size(text):
    """텍스트에서 규격코드를 찾는다. 앞에 오는 체계일수록 특정적이라 우선한다."""
    for key in ('ISS', 'JIS', 'LN', 'L2', 'BCI', 'ETN', 'DIN'):
        m = PAT[key].search(text)
        if not m:
            continue
        if key == 'ETN':
            return ''.join(m.groups()), 'DIN/EN'
        if key in ('LN', 'L2'):
            return m.group(1).upper(), 'DIN/EN'
        if key == 'ISS':
            return m.group(1).upper(), 'JIS-ISS'
        if key == 'JIS':
            return m.group(1).upper(), 'JIS'
        if key == 'BCI':
            return 'BCI ' + m.group(1).upper(), 'BCI'
        return m.group(1), 'DIN/EN'
    return '', ''


def parse_specs(text, limit=400, loose=False):
    """한 문서/페이지에서 (규격, 체계, Ah, CCA, 치수, 기술) 후보를 긁는다.

    줄 단위로 본다.  카탈로그 표는 한 줄에 한 제품이 오는 경우가 많아서
    줄 안에 규격과 숫자가 같이 있으면 신뢰도가 올라간다."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if len(line) < 8 or len(line) > 300:
            continue
        size, std = find_size(line)
        ah = AH_RE.search(line)
        if not size and not (loose and ah):
            continue
        cca = None
        for m in CCA_RE.finditer(line):
            val = m.group(1) or m.group(2)
            if val and 100 <= int(val) <= 2000:
                cca = (int(val), (m.group(3) or '').upper())
                break
        dim = DIM_RE.search(line)
        volt = VOLT_RE.search(line)
        tech = TECH_RE.search(line)
        score = sum([bool(ah), bool(cca), bool(dim)])
        if score == 0 or (not size and not (ah and cca)):
            continue
        out.append({
            'size': size, 'std': std,
            'ah': int(ah.group(1)) if ah else '',
            'cca': cca[0] if cca else '',
            'ccaStd': (cca[1] if cca and cca[1] in ('EN', 'SAE') else ''),
            'dim': 'x'.join(dim.groups()) if dim else '',
            'v': volt.group(1) if volt else '12',
            'tech': (tech.group(1).upper() if tech else ''),
            'conf': ('낮음' if not size else ['낮음', '보통', '높음'][min(score, 3) - 1]),
            'raw': line[:160],
        })
        if len(out) >= limit:
            break
    return out


# ── 파일 처리 ────────────────────────────────────────────────────────────
def _pdf_reader():
    """pypdf 를 불러온다.  없으면 None.

    ImportError 만 잡으면 안 된다.  pypdf 가 의존하는 cryptography 가 깨진
    PC 에서는 pyo3 의 PanicException 이 올라오는데, 이건 Exception 이 아니라
    BaseException 상속이라 그냥 두면 수집 전체가 멈춘다.  본문 추출은 못 해도
    PDF 를 받아 해시·페이지수를 남기는 일은 계속돼야 한다."""
    for mod in ('pypdf', 'PyPDF2'):
        try:
            return __import__(mod, fromlist=['PdfReader']).PdfReader
        except (KeyboardInterrupt, SystemExit):
            raise
        except BaseException:
            continue
    return None


def pdf_text(path):
    PdfReader = _pdf_reader()
    if PdfReader is None:
        return None
    try:
        reader = PdfReader(path)
        return '\n'.join((p.extract_text() or '') for p in reader.pages)
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException:
        return None


def pdf_pages(path):
    try:
        with open(path, 'rb') as fp:
            blob = fp.read()
        n = len(re.findall(rb'/Type\s*/Page[^s]', blob))
        if n:
            return n
        counts = re.findall(rb'/Count\s+(\d+)', blob)
        return max(int(x) for x in counts) if counts else ''
    except Exception:
        return ''


def html_text(html):
    """태그를 걷어내되 줄 구조는 남긴다 — 표 한 줄이 한 제품인 경우가 많다."""
    html = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', html)
    html = re.sub(r'(?i)</(tr|p|div|li|h[1-6])>', '\n', html)
    html = re.sub(r'(?i)</t[dh]>', ' | ', html)
    text = re.sub(r'<[^>]+>', ' ', html)
    text = (text.replace('&nbsp;', ' ').replace('&amp;', '&')
                .replace('&lt;', '<').replace('&gt;', '>'))
    return re.sub(r'[ \t]{2,}', ' ', text)


def expand(url, spec):
    """URL 의 {변수} 를 값 목록으로 펼친다.  'code=A|B; lang=en' 형식."""
    if not spec:
        return [url]
    pools = {}
    for part in spec.split(';'):
        if '=' not in part:
            continue
        name, values = part.split('=', 1)
        pools[name.strip()] = [v.strip() for v in values.split('|') if v.strip()]
    if not pools:
        return [url]
    names = list(pools)
    out = []
    for combo in itertools.product(*(pools[n] for n in names)):
        u = url
        for n, v in zip(names, combo):
            u = u.replace('{%s}' % n, v)
        out.append(u)
    return out


def safe_name(url, fallback):
    name = os.path.basename(urllib.parse.urlparse(url).path) or fallback
    name = urllib.parse.unquote(name)
    name = re.sub(r'[^\w.\-가-힣]+', '_', name) or fallback
    return name[:110]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sources', default=os.path.join(ROOT, 'data', 'catalog_sources.csv'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'catalogs'))
    ap.add_argument('--only', nargs='*', help='브랜드마켓 키')
    ap.add_argument('--types', nargs='*', help='pdf / productlist / sitemap / pattern / fitment')
    ap.add_argument('--dry', action='store_true', help='받지 않고 URL 만 펼쳐 본다')
    ap.add_argument('--dist', help='유통사 소스 CSV (기본 data/distributor_sources.csv)')
    ap.add_argument('--brands', action='store_true',
                    help='유통사 사이트를 훑어 취급 브랜드를 찾아낸다')
    ap.add_argument('--loose', action='store_true',
                    help='규격코드가 없어도 용량·CCA 가 있으면 낮은 확신도로 수집')
    ap.add_argument('--max-urls', type=int, default=40, help='한 소스에서 받을 URL 상한')
    ap.add_argument('--timeout', type=int, default=60)
    ap.add_argument('--check', action='store_true',
                    help='받지 않고 URL 이 열리는지만 확인해 url_check.csv 를 낸다')
    ap.add_argument('--check-timeout', type=int, default=15)
    args = ap.parse_args()

    with open(args.sources, encoding='utf-8-sig') as fp:
        sources = list(csv.DictReader(fp))
    if args.only:
        sources = [s for s in sources if s['브랜드마켓'] in args.only]
    if args.types:
        sources = [s for s in sources if s['유형'] in args.types]

    session = requests.Session()
    session.headers.update({'User-Agent': UA, 'Accept': '*/*'})
    today = datetime.date.today().isoformat()
    registry, models, log, check = [], [], [], []
    seen_model = set()

    for src in sources:
        bm, brand, maker = src['브랜드마켓'], src['브랜드'], src['제조사']
        kind, url, var = src['유형'], src['URL'].strip(), src.get('패턴변수', '')
        if not url:
            continue
        urls = expand(url, var) if kind == 'pattern' else [url]
        urls = urls[:args.max_urls]
        if args.dry:
            for u in urls:
                print('%-14s %-12s %s' % (bm, kind, u))
            continue

        # --check: 받지 않고 살아있는지만 본다.  본 수집을 걸기 전에
        # "이 회사 네트워크에서 몇 개나 열리나" 를 1~2분에 답하려고 있다.
        if args.check:
            for u in urls:
                try:
                    r = session.head(u, timeout=args.check_timeout, allow_redirects=True)
                    # HEAD 를 막아둔 서버가 많다.  그때는 GET 으로 한 번 더 본다.
                    if r.status_code in (400, 401, 403, 405, 501):
                        r = session.get(u, timeout=args.check_timeout,
                                        allow_redirects=True, stream=True)
                        r.close()
                    ok = r.status_code < 400
                    size = r.headers.get('content-length', '')
                    check.append([bm, kind, u, r.status_code,
                                  '열림' if ok else '막힘', size,
                                  r.headers.get('content-type', '')[:40]])
                    print('  %s %-12s %s %s' % ('OK ' if ok else '   ', bm,
                                                r.status_code, u[:70]))
                except Exception as exc:
                    check.append([bm, kind, u, '', '실패', '', str(exc)[:80]])
                    print('   X  %-12s %s' % (bm, str(exc)[:70]))
            continue

        folder = os.path.join(args.out, bm)
        os.makedirs(folder, exist_ok=True)
        for u in urls:
            try:
                resp = session.get(u, timeout=args.timeout, allow_redirects=True)
                resp.raise_for_status()
            except Exception as exc:
                log.append([bm, kind, u, '실패', 0, str(exc)[:120]])
                print('  [실패] %-12s %s' % (bm, str(exc)[:70]))
                continue

            body, ctype = resp.content, resp.headers.get('content-type', '').lower()
            is_pdf = body[:5] == b'%PDF-' or 'pdf' in ctype

            if kind == 'sitemap' or u.endswith('.xml'):
                locs = re.findall(r'<loc>\s*([^<]+?)\s*</loc>', resp.text)
                keep = [l for l in locs if re.search(r'batter|produkt|product|제품', l, re.I)]
                log.append([bm, kind, u, '성공', len(keep), '제품 URL 후보'])
                print('  [사이트맵] %-12s %d개 URL 발굴' % (bm, len(keep)))
                for l in keep[:args.max_urls]:
                    log.append([bm, 'sitemap-child', l, '대기', 0, '다음 실행에서 productlist 로 처리'])
                continue

            if is_pdf:
                dest = os.path.join(folder, safe_name(u, bm + '.pdf'))
                with open(dest, 'wb') as fp:
                    fp.write(body)
                sha = hashlib.sha256(body).hexdigest()
                pages = pdf_pages(dest)
                text = pdf_text(dest)
                found = parse_specs(text, loose=args.loose) if text else []
                registry.append([bm, maker, src.get('비고', '') or os.path.basename(dest), '', '',
                                 u, os.path.relpath(dest, ROOT), sha, pages, today, '수집완료',
                                 '%.1f MB / 스펙 %d건' % (len(body) / 1048576.0, len(found))
                                 + ('' if text else ' / 본문추출 실패 — pip install pypdf')])
                print('  [PDF]  %-12s %-40s %s쪽 스펙 %d건'
                      % (bm, os.path.basename(dest)[:40], pages, len(found)))
            else:
                text = html_text(resp.text)
                found = parse_specs(text, loose=args.loose)
                dest = os.path.join(folder, safe_name(u, bm + '.html') + '.html')
                with open(dest, 'w', encoding='utf-8') as fp:
                    fp.write(resp.text)
                log.append([bm, kind, u, '성공', len(found), os.path.relpath(dest, ROOT)])
                print('  [HTML] %-12s %-40s 스펙 %d건' % (bm, safe_name(u, '')[:40], len(found)))

            for f in found:
                key = (bm, f['size'], f['ah'], f['cca'])
                if key in seen_model:
                    continue
                seen_model.add(key)
                tech = {'AGM': 'AGM', 'EFB': 'EFB'}.get(f['tech'], 'FLD')
                models.append([
                    '타사', maker, brand, '%s %s' % (brand, f['size']), f['size'], f['std'],
                    tech, '승용SLI', f['v'], f['ah'], '',
                    f['cca'] if f['ccaStd'] != 'EN' else '',
                    f['cca'] if f['ccaStd'] == 'EN' else '',
                    src.get('마켓', ''), '수집(자동추출)', os.path.basename(u), '',
                    u, '확신도 %s / %s' % (f['conf'], f['raw'])])

    # ── 유통사 취급 브랜드 탐지 ─────────────────────────────────────────
    # 바이어(유통사)는 우리 것만 팔지 않는다.  그 사이트에 같이 올라와 있는
    # 브랜드를 긁으면 그 나라에서 우리와 붙는 상대가 그대로 나온다.
    brand_rows = []
    if args.brands:
        dist_path = args.dist or os.path.join(ROOT, 'data', 'distributor_sources.csv')
        with open(dist_path, encoding='utf-8-sig') as fp:
            dists = list(csv.DictReader(fp))
        for d in dists:
            urls = [u for u in (d.get('제품목록URL'), d.get('사이트')) if u]
            if not urls:
                log.append([d['유통사키'], 'brands', '', '건너뜀', 0, 'URL 없음 — 사이트를 찾아 채울 것'])
                continue
            found, src = set(), ''
            for u in urls[:2]:
                if args.dry:
                    print('%-16s brands       %s' % (d['유통사키'], u))
                    continue
                try:
                    resp = session.get(u, timeout=args.timeout)
                    resp.raise_for_status()
                except Exception as exc:
                    log.append([d['유통사키'], 'brands', u, '실패', 0, str(exc)[:120]])
                    continue
                text = html_text(resp.text)
                low = text.lower()
                for b in BRAND_DICT:
                    if re.search(r'(?<![A-Za-z])' + re.escape(b.lower()) + r'(?![A-Za-z])', low):
                        found.add(b)
                src = src or u
            if args.dry:
                continue
            known = set(x.strip() for x in (d.get('취급 브랜드') or '').split('|') if x.strip())
            for b in sorted(found):
                brand_rows.append([d['유통사'], d.get('국가', ''), d.get('지역', ''), b, src, today])
            new = found - known
            print('  [브랜드] %-16s %d개 발견%s' % (d['유통사키'], len(found),
                  (' / 새로 나온 것: ' + ', '.join(sorted(new))) if new else ''))
            log.append([d['유통사키'], 'brands', src, '성공', len(found),
                        '새 브랜드 ' + str(len(new)) + '개'])

    if args.dry:
        return

    os.makedirs(args.out, exist_ok=True)

    if args.check:
        CHECK_COLS = ['브랜드마켓', '유형', 'URL', '응답코드', '결과', '크기', '비고']
        path = os.path.join(args.out, 'url_check.csv')
        with open(path, 'w', encoding='utf-8-sig', newline='') as fp:
            w = csv.writer(fp)
            w.writerow(CHECK_COLS)
            w.writerows(check)
        ok = sum(1 for r in check if r[4] == '열림')
        print('\n' + '=' * 52)
        print('  주소 %d개 중 %d개가 열린다.' % (len(check), ok))
        if ok >= 30:
            print('  아주 좋다 — 바로 전체 수집(2번)으로 가도 된다.')
        elif ok >= 10:
            print('  쓸 만하다 — PDF 만(3번) 먼저 돌려봐라.')
        else:
            print('  너무 적다 — 회사 방화벽이 막는 것 같다.')
            print('  폰 핫스팟에 물려서 다시 돌려봐라.')
        print('  자세한 내역: %s' % path)
        print('=' * 52)
        return
    if args.brands:
        with open(os.path.join(args.out, 'discovered_brands.csv'), 'w',
                  encoding='utf-8-sig', newline='') as fp:
            w = csv.writer(fp)
            w.writerow(BRAND_COLS)
            w.writerows(brand_rows)
    for name, cols, rows in (('catalog_registry.csv', REGISTRY_COLS, registry),
                             ('collected_models.csv', MODEL_COLS, models),
                             ('collect_log.csv', LOG_COLS, log)):
        with open(os.path.join(args.out, name), 'w', encoding='utf-8-sig', newline='') as fp:
            w = csv.writer(fp)
            w.writerow(cols)
            w.writerows(rows)
    print('\n원본 %d건 / 추출 스펙 %d행 / 로그 %d줄%s → %s'
          % (len(registry), len(models), len(log),
             (' / 유통사 취급 브랜드 %d행' % len(brand_rows)) if brand_rows else '', args.out))
    print('collected_models.csv 는 자동 추출이라 그대로 믿으면 안 된다. '
          '앱에 올린 뒤 확신도 낮은 행부터 원본과 대조할 것.')


if __name__ == '__main__':
    main()
