#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""더블클릭용 메뉴 — 배치파일이 하던 일을 파이썬으로 옮겼다.

윈도우 한글 cmd 는 .bat 를 CP949 로 읽는다.  UTF-8 로 저장한 배치에 한글을
넣으면 바이트가 깨지면서 파서가 줄 중간을 잘라먹는다(`echo` 가 `ho` 가 된다).
chcp 65001 을 앞에 둬도 이미 파싱이 시작된 뒤라 소용이 없다.

그래서 .bat 는 순수 ASCII 로 파이썬만 찾고, 한글 안내와 실제 일은 전부 여기서
한다.  파이썬은 콘솔에 유니코드를 직접 쓰기 때문에 코드페이지와 상관없다."""
import os
import subprocess
import sys

try:                                    # 콘솔이 못 그리는 글자가 있어도 죽지 않게
    sys.stdout.reconfigure(errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
COLLECT = os.path.join(HERE, 'collect.py')
PY = sys.executable

MENU = [
    ('1', '주소가 살아있는지 확인 (1~2분, 파일은 안 받음)', ['--check'], True),
    ('2', '카달로그 전체 수집 (수십 분)',                    [],         False),
    ('3', 'PDF 만 수집 (빠름)',                              ['--types', 'pdf'], False),
    ('4', '유통사 사이트에서 경쟁 브랜드 찾기',              ['--brands'], False),
    ('5', '받을 주소 목록만 화면에 보기 (확인도 안 함)',     ['--dry'],  False),
]


def line(ch='=', n=52):
    print(ch * n)


def ensure_deps():
    """필요한 부품을 깐다.  이미 있으면 건너뛴다."""
    need = []
    for mod, pkg in (('requests', 'requests'), ('pypdf', 'pypdf')):
        try:
            __import__(mod)
        except (KeyboardInterrupt, SystemExit):
            raise
        except BaseException:
            need.append(pkg)
    if not need:
        print('[2/3] 필요한 부품: 이미 다 있습니다.\n')
        return True

    print('[2/3] 필요한 부품을 설치합니다 (처음 한 번만 오래 걸립니다)...')
    print('      ' + ', '.join(need))
    cmd = [PY, '-m', 'pip', 'install', '--user', '--quiet'] + need
    if subprocess.call(cmd) == 0:
        print('      완료.\n')
        return True

    print()
    print('[X] 설치가 실패했습니다. 회사 네트워크가 막고 있을 수 있습니다.')
    print('    IT 팀에 회사 프록시 주소를 물어본 뒤, 명령 프롬프트에 아래를 넣으세요.')
    print()
    print('    "%s" -m pip install --user --proxy http://프록시주소:포트 %s'
          % (PY, ' '.join(need)))
    print()
    print('    requests 만 있어도 1번(주소 확인)은 돌아갑니다.')
    print('    pypdf 가 없으면 PDF 본문 추출만 건너뜁니다.')
    print()
    try:
        __import__('requests')
        return True                     # requests 만 있으면 일단 진행한다
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException:
        return False


def main():
    print()
    line()
    print('   배터리 카달로그 수집기')
    line()
    print()
    print('[1/3] 파이썬 확인: %s' % sys.version.split()[0])
    print('      %s\n' % PY)

    if not ensure_deps():
        return 1

    if not os.path.exists(COLLECT):
        print('[X] tools\\collect.py 를 찾을 수 없습니다.')
        print('    압축을 풀 때 폴더 구조가 깨진 것 같습니다.')
        print('    찾은 위치: %s' % COLLECT)
        return 1

    print('[3/3] 무엇을 할까요?\n')
    for key, label, _args, first in MENU:
        print('   %s  %s%s' % (key, label, '   <-- 처음엔 이것부터' if first else ''))
    print('   0  그냥 나가기\n')

    try:
        sel = input('번호를 넣고 엔터: ').strip()
    except (EOFError, KeyboardInterrupt):
        return 0
    if sel == '0':
        return 0

    for key, _label, args, _first in MENU:
        if sel == key:
            print()
            rc = subprocess.call([PY, COLLECT] + args)
            print()
            line()
            print('  끝났습니다.')
            print()
            print('  결과는 catalogs 폴더 안에 있습니다:')
            print('    url_check.csv          1번 — 주소별로 열림/막힘')
            print('    collect_log.csv        2·3·4번 — 되고 안 된 내역')
            print('    collected_models.csv   뽑아낸 스펙 -> 앱에 올릴 파일')
            print('    catalog_registry.csv   근거 (파일명·SHA-256·페이지수)')
            print('  폴더: %s' % os.path.join(ROOT, 'catalogs'))
            line()
            return rc

    print('\n0, 1, 2, 3, 4, 5 중에서 골라주세요.')
    return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print('\n중단했습니다.')
        sys.exit(130)
