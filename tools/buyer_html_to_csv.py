#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""사내 '배터리 설계·수익성 검토 시스템' HTML → 배터리 카달로그 앱 임포트용 CSV.

그 HTML 안에는 <script id="buyerDataB64"> 로 바이어 DB 가 gzip+base64 로
들어 있다.  바이어번호·바이어명·제품형명·C20·RC·CCA(SAE/EN)·바이어 표기치가
한 행씩 붙어 있어서, 우리가 실제로 어느 나라에 무슨 제품을 파는지가 여기 다 있다.

하는 일
  1. buyerDataB64 를 풀어 46,000 행대의 바이어 행을 읽는다
  2. 바이어명에서 국가를 뽑는다 ('BOSCH CONGO', 'YBS(FRANCE)', 'A-MAP(ARMENIA)')
  3. 제품형명 × 국가로 묶어 앱 임포트 CSV 를 만든다
  4. 바이어 목록과, 국가를 못 뽑은 바이어 목록을 따로 뽑는다

만드는 파일
  buyer_models.csv    앱 [데이터 관리 → CSV 가져오기] 용 (제품형명 × 국가)
  buyer_registry.csv  바이어 목록 (번호·이름·국가·지역·제품수)
  buyer_unmapped.csv  국가를 못 뽑은 바이어 — 채워서 --map 으로 다시 넣으면 반영된다
  buyer_detail.csv    원본 전체 행 (--detail 일 때만)

주의: 바이어명·고객품번은 영업 정보다.  결과 CSV 를 저장소에 커밋하지 말 것.
      (이 저장소는 공개다.  .gitignore 로 막아뒀지만 파일명을 바꾸면 뚫린다.)

사용법
    python3 tools/buyer_html_to_csv.py 시스템.html 출력폴더
    python3 tools/buyer_html_to_csv.py 시스템.html 출력폴더 --map 국가매핑.csv --detail
"""
import argparse
import base64
import collections
import csv
import gzip
import io
import json
import os
import re
import sys

# 바이어명에서 국가를 뽑는 사전.  긴 이름을 먼저 봐야
# 'GUINEA' 가 'EQ. GUINEA' 를, 'NIGER' 가 'NIGERIA' 를 먹지 않는다.
COUNTRY = [
    ('SOUTH AFRICA', '남아공', 'MEA'), ('NEW ZEALAND', '뉴질랜드', 'OCE'),
    ('IVORY COAST', '코트디부아르', 'MEA'), ('COTEDIVOIRE', '코트디부아르', 'MEA'),
    ("COTE D'IVOIRE", '코트디부아르', 'MEA'), ('BURKINA', '부르키나파소', 'MEA'),
    ('EQ. GUINEA', '적도기니', 'MEA'), ('EQUATORIAL GUINEA', '적도기니', 'MEA'),
    ('COSTA RICA', '코스타리카', 'LAT'), ('DOMINICAN', '도미니카', 'LAT'),
    ('EL SALVADOR', '엘살바도르', 'LAT'), ('SALVADOR', '엘살바도르', 'LAT'),
    ('PUERTO RICO', '푸에르토리코', 'LAT'), ('SAUDI', '사우디', 'MEA'), ('KSA', '사우디', 'MEA'),
    ('SIERRA LEONE', '시에라리온', 'MEA'), ('SRI LANKA', '스리랑카', 'IN'),
    ('HONG KONG', '홍콩', 'CN'), ('NIGERIA', '나이지리아', 'MEA'),
    ('KYRGYZ', '키르기스스탄', 'ETC'), ('KAZAKH', '카자흐스탄', 'ETC'),
    ('UZBEK', '우즈베키스탄', 'ETC'), ('TAJIK', '타지키스탄', 'ETC'),
    ('TURKMEN', '투르크메니스탄', 'ETC'), ('AZERBAIJAN', '아제르바이잔', 'ETC'),
    ('AFGHAN', '아프가니스탄', 'ETC'), ('SEYCHELLES', '세이셸', 'MEA'),
    ('MAURITIUS', '모리셔스', 'MEA'), ('MAURITANIA', '모리타니', 'MEA'),
    ('MADAGASCAR', '마다가스카르', 'MEA'), ('MOZAMBIQUE', '모잠비크', 'MEA'),
    ('BOTSWANA', '보츠와나', 'MEA'), ('NAMIBIA', '나미비아', 'MEA'),
    ('ZIMBABWE', '짐바브웨', 'MEA'), ('ZAMBIA', '잠비아', 'MEA'),
    ('TANZANIA', '탄자니아', 'MEA'), ('ETHIOPIA', '에티오피아', 'MEA'),
    ('CAMEROON', '카메룬', 'MEA'), ('SENEGAL', '세네갈', 'MEA'),
    ('LIBERIA', '라이베리아', 'MEA'), ('MOROCCO', '모로코', 'MEA'),
    ('ALGERIA', '알제리', 'MEA'), ('TUNISIA', '튀니지', 'MEA'), ('LIBYA', '리비아', 'MEA'),
    ('EGYPT', '이집트', 'MEA'), ('SUDAN', '수단', 'MEA'), ('GHANA', '가나', 'MEA'),
    ('KENYA', '케냐', 'MEA'), ('UGANDA', '우간다', 'MEA'), ('ANGOLA', '앙골라', 'MEA'),
    ('CONGO', '콩고', 'MEA'), ('GABON', '가봉', 'MEA'), ('BENIN', '베냉', 'MEA'),
    ('GUINEA', '기니', 'MEA'), ('TOGO', '토고', 'MEA'), ('MALI', '말리', 'MEA'),
    ('NIGER', '니제르', 'MEA'), ('CHAD', '차드', 'MEA'), ('SOMALIA', '소말리아', 'MEA'),
    ('DJIBOUTI', '지부티', 'MEA'), ('GAMBIA', '감비아', 'MEA'), ('RWANDA', '르완다', 'MEA'),
    ('UAE', 'UAE', 'MEA'), ('DUBAI', 'UAE', 'MEA'), ('IRAQ', '이라크', 'MEA'),
    ('IRAN', '이란', 'MEA'), ('SYRIA', '시리아', 'MEA'), ('JORDAN', '요르단', 'MEA'),
    ('LEBANON', '레바논', 'MEA'), ('KUWAIT', '쿠웨이트', 'MEA'), ('QATAR', '카타르', 'MEA'),
    ('OMAN', '오만', 'MEA'), ('BAHRAIN', '바레인', 'MEA'), ('YEMEN', '예멘', 'MEA'),
    ('ISRAEL', '이스라엘', 'MEA'), ('TURKEY', '터키', 'MEA'), ('TURKIYE', '터키', 'MEA'),
    ('GERMANY', '독일', 'EU'), ('GMBH', '독일', 'EU'), ('FRANCE', '프랑스', 'EU'),
    ('SPAIN', '스페인', 'EU'), ('ITALY', '이탈리아', 'EU'), ('SWEDEN', '스웨덴', 'EU'),
    ('NORWAY', '노르웨이', 'EU'), ('FINLAND', '핀란드', 'EU'), ('DENMARK', '덴마크', 'EU'),
    ('POLAND', '폴란드', 'EU'), ('NETHERLAND', '네덜란드', 'EU'), ('HOLLAND', '네덜란드', 'EU'),
    ('BELGIUM', '벨기에', 'EU'), ('IRELAND', '아일랜드', 'EU'), ('GREECE', '그리스', 'EU'),
    ('PORTUGAL', '포르투갈', 'EU'), ('AUSTRIA', '오스트리아', 'EU'),
    ('SWITZERLAND', '스위스', 'EU'), ('CZECH', '체코', 'EU'), ('SLOVAK', '슬로바키아', 'EU'),
    ('HUNGARY', '헝가리', 'EU'), ('ROMANIA', '루마니아', 'EU'), ('BULGARIA', '불가리아', 'EU'),
    ('CROATIA', '크로아티아', 'EU'), ('SLOVENIA', '슬로베니아', 'EU'), ('SERBIA', '세르비아', 'EU'),
    ('ALBANIA', '알바니아', 'EU'), ('CYPRUS', '키프로스', 'EU'), ('ESTONIA', '에스토니아', 'EU'),
    ('LATVIA', '라트비아', 'EU'), ('LITHUANIA', '리투아니아', 'EU'), ('MALTA', '몰타', 'EU'),
    ('ICELAND', '아이슬란드', 'EU'), ('LUXEMBOURG', '룩셈부르크', 'EU'),
    ('RUSSIA', '러시아', 'ETC'), ('UKRAINE', '우크라이나', 'ETC'), ('BELARUS', '벨라루스', 'ETC'),
    ('ARMENIA', '아르메니아', 'ETC'), ('GEORGIA', '조지아', 'ETC'), ('MOLDOVA', '몰도바', 'ETC'),
    ('CANADA', '캐나다', 'NA'), ('MEXICO', '멕시코', 'LAT'), ('U.S.A', '미국', 'NA'),
    ('USA', '미국', 'NA'), ('AMERICA', '미국', 'NA'), ('BRAZIL', '브라질', 'LAT'),
    ('BRASIL', '브라질', 'LAT'), ('CHILE', '칠레', 'LAT'), ('PERU', '페루', 'LAT'),
    ('COLOMBIA', '콜롬비아', 'LAT'), ('ARGENTINA', '아르헨티나', 'LAT'),
    ('ECUADOR', '에콰도르', 'LAT'), ('PANAMA', '파나마', 'LAT'), ('GUATEMALA', '과테말라', 'LAT'),
    ('PARAGUAY', '파라과이', 'LAT'), ('URUGUAY', '우루과이', 'LAT'), ('BOLIVIA', '볼리비아', 'LAT'),
    ('VENEZUELA', '베네수엘라', 'LAT'), ('HONDURAS', '온두라스', 'LAT'),
    ('NICARAGUA', '니카라과', 'LAT'), ('JAMAICA', '자메이카', 'LAT'),
    ('TRINIDAD', '트리니다드토바고', 'LAT'), ('CUBA', '쿠바', 'LAT'), ('HAITI', '아이티', 'LAT'),
    ('BAHAMAS', '바하마', 'LAT'), ('BELIZE', '벨리즈', 'LAT'), ('GUYANA', '가이아나', 'LAT'),
    ('SURINAME', '수리남', 'LAT'),
    ('JAPAN', '일본', 'JP'), ('KOREA', '한국', 'KR'), ('CHINA', '중국', 'CN'),
    ('TAIWAN', '대만', 'CN'), ('VIETNAM', '베트남', 'SEA'), ('THAILAND', '태국', 'SEA'),
    ('THAI', '태국', 'SEA'), ('MALAYSIA', '말레이시아', 'SEA'), ('INDONESIA', '인도네시아', 'SEA'),
    ('PHILIPPIN', '필리핀', 'SEA'), ('SINGAPORE', '싱가포르', 'SEA'), ('MYANMAR', '미얀마', 'SEA'),
    ('CAMBODIA', '캄보디아', 'SEA'), ('LAOS', '라오스', 'SEA'), ('BRUNEI', '브루나이', 'SEA'),
    ('INDIA', '인도', 'IN'), ('PAKISTAN', '파키스탄', 'IN'), ('BANGLADESH', '방글라데시', 'IN'),
    ('NEPAL', '네팔', 'IN'), ('MALDIVES', '몰디브', 'IN'),
    ('AUSTRALIA', '호주', 'OCE'), ('FIJI', '피지', 'OCE'), ('PAPUA', '파푸아뉴기니', 'OCE'),
    ('UK', '영국', 'EU'), ('ENGLAND', '영국', 'EU'), ('SCOTLAND', '영국', 'EU'),
]

BUYER_FIELDS = ['productCode', 'baseCode', 'buyerNo', 'buyerName', 'model', 'variant', 'desc',
                'c20', 'rc', 'cca', 'sae', 'en', 'htmlSae', 'htmlEn', 'htmlName', 'matchedName',
                'matchedType', 'score', 'reason', 'label', 'ccaType', 'diff', 'variantFlag',
                'htmlExists']

MODEL_COLS = ['구분', '제조사', '브랜드', '모델', '규격그룹', '규격체계', '기술', '용도', '전압',
              'C20용량', 'RC분', 'CCA_SAE', 'CCA_EN', '국가', '판매지역', '유통사', '바이어수',
              '표기_CCA_SAE', '표기_CCA_EN', '검증상태', '출처', '비고']
REG_COLS = ['바이어번호', '바이어명', '국가', '지역', '제품수', '제품형명수']
UNMAP_COLS = ['바이어명', '행수', '국가', '지역']

# 제품군 판별 — 사내 형명에 규격이 들어 있다
SIZE_PATTERNS = [
    (re.compile(r'\b(\d{2,3}[BD]\d{2}[LR]?)\b', re.I), 'JIS'),
    (re.compile(r'\b([KMNQST]-?\d{2,3})\b'), 'JIS-ISS'),
    (re.compile(r'\b(LBN[1-4]|LN[0-6])\b', re.I), 'DIN/EN'),
    (re.compile(r'\b([5-7]\d{4})\b'), 'DIN/EN'),
    (re.compile(r'\bBCI\s*(\d{2,3}R?F?)\b', re.I), 'BCI'),
    (re.compile(r'\b(\d{2,3}(?:MS|DT|RA)?)-\d{3}\b'), 'BCI'),
]


def country_of(name):
    upper = (name or '').upper()
    for needle, ctry, region in COUNTRY:
        if needle in upper:
            return ctry, region
    return '', ''


def size_of(model):
    for pattern, std in SIZE_PATTERNS:
        m = pattern.search(model or '')
        if m:
            return m.group(1).upper(), std
    return '', ''


def num(v):
    try:
        f = float(str(v).replace(',', ''))
        return int(f) if f == int(f) else f
    except (TypeError, ValueError):
        return ''


def load_rows(html_path):
    with io.open(html_path, encoding='utf-8', errors='replace') as fp:
        html = fp.read()
    m = re.search(r'<script id="buyerDataB64"[^>]*>([A-Za-z0-9+/=\s]+)</script>', html)
    if not m:
        sys.exit('buyerDataB64 스크립트를 찾지 못했다. 파일이 맞는지 확인할 것.')
    raw = gzip.decompress(base64.b64decode(re.sub(r'\s', '', m.group(1))))
    return [dict(zip(BUYER_FIELDS, r)) for r in json.loads(raw.decode('utf-8'))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('html')
    ap.add_argument('outdir')
    ap.add_argument('--map', help='국가를 못 뽑은 바이어를 채운 CSV (바이어명,국가,지역)')
    ap.add_argument('--detail', action='store_true', help='원본 전체 행도 내보낸다')
    ap.add_argument('--maker', default='세방전지')
    ap.add_argument('--brand', default='GB')
    args = ap.parse_args()

    rows = load_rows(args.html)
    manual = {}
    if args.map and os.path.exists(args.map):
        with io.open(args.map, encoding='utf-8-sig') as fp:
            for r in csv.DictReader(fp):
                if r.get('국가'):
                    manual[r['바이어명'].strip()] = (r['국가'].strip(), r.get('지역', '').strip())

    def geo(name):
        key = (name or '').strip()
        if key in manual:
            return manual[key]
        return country_of(key)

    os.makedirs(args.outdir, exist_ok=True)

    # ── 제품형명 × 국가 ────────────────────────────────────────────────
    agg = collections.OrderedDict()
    for r in rows:
        model = str(r['model']).strip()
        if not model:
            continue
        ctry, region = geo(r['buyerName'])
        key = (model, ctry)
        a = agg.setdefault(key, {'buyers': set(), 'c20': [], 'rc': [], 'sae': [],
                                 'en': [], 'hsae': [], 'hen': [], 'region': region})
        a['buyers'].add(str(r['buyerName']).strip())
        for src, dst in (('c20', 'c20'), ('rc', 'rc'), ('sae', 'sae'), ('en', 'en'),
                         ('htmlSae', 'hsae'), ('htmlEn', 'hen')):
            v = num(r[src])
            if v != '':
                a[dst].append(v)
        if not a['region'] and region:
            a['region'] = region

    def mode(values):
        """가장 자주 나온 값.  같은 형명이라도 바이어마다 표기가 달라서 최빈값을 쓴다."""
        return collections.Counter(values).most_common(1)[0][0] if values else ''

    out = []
    for (model, ctry), a in agg.items():
        size, std = size_of(model)
        out.append([
            '자사', args.maker, args.brand, model, size, std, '', '', 12,
            mode(a['c20']), mode(a['rc']), mode(a['sae']), mode(a['en']),
            ctry, a['region'], '', len(a['buyers']),
            mode(a['hsae']), mode(a['hen']),
            '사내 바이어DB', '설계·수익성 검토 시스템 (buyerDataB64)',
            '바이어 %d곳' % len(a['buyers'])])

    # ── 바이어 목록 ────────────────────────────────────────────────────
    reg = collections.OrderedDict()
    for r in rows:
        name = str(r['buyerName']).strip()
        if not name:
            continue
        b = reg.setdefault(name, {'no': str(r['buyerNo']).strip(), 'rows': 0, 'models': set()})
        b['rows'] += 1
        b['models'].add(str(r['model']).strip())
    reg_rows, unmapped = [], []
    for name, b in sorted(reg.items(), key=lambda x: -x[1]['rows']):
        ctry, region = geo(name)
        reg_rows.append([b['no'], name, ctry, region, b['rows'], len(b['models'])])
        if not ctry:
            unmapped.append([name, b['rows'], '', ''])

    files = [('buyer_models.csv', MODEL_COLS, out),
             ('buyer_registry.csv', REG_COLS, reg_rows),
             ('buyer_unmapped.csv', UNMAP_COLS, unmapped)]
    if args.detail:
        files.append(('buyer_detail.csv', BUYER_FIELDS,
                      [[r[k] for k in BUYER_FIELDS] for r in rows]))
    for name, cols, data in files:
        with io.open(os.path.join(args.outdir, name), 'w', encoding='utf-8-sig', newline='') as fp:
            w = csv.writer(fp)
            w.writerow(cols)
            w.writerows(data)

    known = sum(1 for r in reg_rows if r[2])
    print('바이어 행 %d → 제품형명×국가 %d행' % (len(rows), len(out)))
    print('바이어 %d곳 중 %d곳 국가 인식 (%d곳은 buyer_unmapped.csv 에 남겼다)'
          % (len(reg_rows), known, len(unmapped)))
    print('국가 %d개 / 제품형명 %d개' % (len({r[13] for r in out if r[13]}),
                                        len({r[3] for r in out})))
    print('→ %s' % args.outdir)
    print('바이어명·고객품번은 영업 정보다. 이 CSV 를 저장소에 커밋하지 말 것.')


if __name__ == '__main__':
    main()
