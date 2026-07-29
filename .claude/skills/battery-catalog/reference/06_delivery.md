# 전달 — 사용자 PC 에서 실제로 돌게 만들기

여기가 제일 많이 막히는 구간이다. 앱과 도구를 다 만들어도 **사용자 PC 에서
더블클릭이 안 되면 전부 무용지물**이다. 아래는 전부 실제로 겪은 것이다.

## 0. 목표

> 사용자가 폴더 하나를 받아서, 더블클릭 두 번으로 쓸 수 있어야 한다.
> 명령줄을 외우게 하지 마라. CSV 를 열어 행을 세게 하지 마라.

## 1. 윈도우 배치파일에 한글을 넣지 마라

한글 윈도우 `cmd` 는 `.bat` 를 **CP949 로 읽는다.** UTF-8 로 저장한 배치에
한글을 넣으면 바이트가 깨지면서 파서가 줄 중간을 잘라먹는다.

```
'ho'은(는) 내부 또는 외부 명령, 실행할 수 있는 프로그램...    ← echo 가 ho 로 잘렸다
'g_registry.csv'은(는) ...                                  ← catalog_registry.csv 가 잘렸다
```

`chcp 65001` 을 맨 앞에 둬도 **소용없다.** 이미 파싱이 시작된 뒤다.

**해법:** 배치는 **순수 ASCII** 로 파이썬만 찾아 넘기고, 한글 안내·메뉴·실제
작업은 전부 파이썬이 한다. 파이썬은 콘솔에 유니코드를 직접 쓰기 때문에
코드페이지와 무관하다.

```bat
@echo off
rem ---- ASCII ONLY. Korean cmd reads .bat as CP949. ----
cd /d "%~dp0"
set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY goto nopython
"%PY%" "%~dp0tools\run_menu.py"
goto end
:nopython
echo   [X] Python is not installed.
echo     Start Menu -^> Microsoft Store -^> search "Python" -^> Install
:end
pause
```

`.gitattributes` 에 `*.bat text eol=crlf` 를 넣어라. LF 로 저장되면 `cmd` 가
줄을 제대로 못 읽어 조용히 실패한다.

## 2. zip 은 파이썬으로 구워라

리눅스 `zip` 명령은 한글 파일명에 **UTF-8 플래그(범용 비트 11, 0x800)를 안
단다.** 윈도우 탐색기는 그 플래그가 없으면 이름을 CP949 로 읽고
**"압축(ZIP) 폴더가 올바르지 않습니다"** 로 풀기를 거부한다.

파이썬 `zipfile` 은 비ASCII 이름에 그 플래그를 자동으로 붙인다.

```python
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for n in sorted(files):
            z.write(os.path.join(root, n),
                    os.path.relpath(os.path.join(root, n), src).replace(os.sep, '/'))
# 구운 뒤 반드시 확인
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    print(sum(1 for i in z.infolist() if i.flag_bits & 0x800), '개에 UTF-8 플래그')
```

지정한 폴더에 그대로 풀리게 하려면 **감싸는 폴더 없이 zip 루트에** 넣는다.
파일명이 점으로 시작하면 탐색기에서 안 보이니 쓰지 마라.

## 3. CSV 는 UTF-8 BOM + CRLF

한글 엑셀은 **BOM 이 없으면 UTF-8 을 CP949 로 읽는다.** 전 열이 깨지고 행까지
밀린다. 읽을 때는 `encoding='utf-8-sig'`, 쓸 때는:

```python
with io.open(path, 'w', encoding='utf-8-sig', newline='') as fp:
    w = csv.writer(fp, lineterminator='\r\n')
```

같은 폴더의 CSV 하나는 BOM 이 있고 하나는 없으면 **한쪽만 깨져서 원인을 찾기
어렵다.** 전부 통일하고 실제로 다시 읽어 검증해라.

## 4. 콘솔 표에서 한글은 두 칸이다

`%-16s` 는 글자 수로 맞추기 때문에 한글 줄만 밀린다.

```python
def pad(text, width):
    w = sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in text)
    return text + ' ' * max(0, width - w)
```

## 5. 의존성은 메뉴가 알아서 깔아라

사용자에게 `pip install` 을 시키지 마라. 그리고 **필요한 걸 빠뜨리면 조용히
0건이 나온다** — 엑셀 읽기에 `openpyxl` 이 필요한데 설치 목록에 없어서 xlsx
6개가 전부 0건으로 지나간 적이 있다.

```python
for mod, pkg in (('requests', 'requests'), ('pypdf', 'pypdf'),
                 ('openpyxl', 'openpyxl')):
    try:
        __import__(mod)
    except BaseException:      # ImportError 만 잡으면 안 된다 (7번 참고)
        need.append(pkg)
subprocess.call([sys.executable, '-m', 'pip', 'install', '--user', '--quiet'] + need)
```

실패하면 **회사 프록시를 넣은 명령을 그대로 찍어줘라.** 사내망에서 흔하다.

```
"<python경로>" -m pip install --user --proxy http://프록시:포트 openpyxl
```

그리고 **일부만 깔려도 되는 것은 진행시켜라.** `requests` 만 있으면 주소 확인은
되고, `pypdf` 가 없으면 본문 추출만 건너뛰면 된다.

## 6. 결과를 도구가 직접 말해라

"몇 건 나왔냐" 를 사용자에게 묻지 마라. 요약 화면을 만들어라 — 무엇이 됐고,
확신도가 어떻고, 브랜드별로 몇 건이고, **다음에 뭘 할지**까지.

```
[뽑은 스펙]  총 380건
   높음      38건  용량·CCA 가 다 잡힘
   낮음     316건  숫자 열이 미확정 — 원본 대조 필요
[브랜드별]  Bosch 252 ████████  Century 32 █
------------------------------------------------
  다음에 할 일
  1) 6번 — 받은 카달로그를 폴더로 정리
  2) 앱 -> 데이터 관리 -> CSV 가져오기
```

## 7. `except ImportError` 로는 안 잡히는 게 있다

`pypdf` 가 의존하는 `cryptography` 가 깨진 PC 에서는 `pyo3` 의
`PanicException` 이 올라온다. 이건 **`Exception` 이 아니라 `BaseException`
상속**이라 그냥 두면 수집 전체가 멈춘다.

```python
try:
    from pypdf import PdfReader
except (KeyboardInterrupt, SystemExit):
    raise
except BaseException:          # PanicException 까지 잡는다
    return None
```

부가 기능 하나가 죽어서 본 작업이 멈추면 안 된다. PDF 본문을 못 뽑아도
**받아서 해시·쪽수를 남기는 일은 계속돼야 한다.**

## 8. 폴더 구조와 백업

```
<사용자가 정한 폴더>\
  시작하기.md                  ← 폴더 설명·백업 방법
  battery_catalog.html         ← 더블클릭
  실행하기_윈도우.bat            ← 더블클릭
  글로벌_SLI_배터리_카달로그.xlsx
  data\      주소·유통사 레지스트리
  tools\     파이썬 도구
  catalogs\  받은 카달로그가 쌓인다
  사내자료\   사용자가 이미 갖고 있던 카달로그  ← 커밋 금지
  내보내기\   앱 백업(JSON)을 여기               ← 제일 중요
```

**앱 데이터는 폴더가 아니라 브라우저에 저장된다.** 캐시를 지우거나 PC 를 밀면
날아간다. 그래서 **작업이 끝날 때마다 JSON 백업을 폴더에 떨구게** 안내해야 한다.
폰↔PC 이동도 같은 경로다.

`file://` 로 열면 저장소가 경로에 묶이므로 **폴더를 옮기지 말라고** 명시해라.
옮겨야 하면 먼저 백업.

## 9. 사내에 이미 있는 자료를 먼저 훑어라

이걸 마지막에 깨달았는데 **처음에 물어봤어야 했다.**

웹에서 카달로그 주소를 찾는 것보다, 사용자가 이미 모아둔 PDF·엑셀을 읽는 게
빠르고 정확하다. 실제로 Banner·FIAMM·Leoch·Camel 은 우리가 찾은 주소가 전부
404 였는데 사내에는 실물 PDF 가 있었다.

**엑셀은 열 제목을 읽어라.** 행을 문자열로 이어 붙여 정규식으로 긁으면 0건이
나온다 — 표에 단위가 없으니 당연하다. `품번 | 규격 | C20 | CCA` 제목을 찾아
열을 짚으면 확신도 `높음` 으로 바로 들어온다.

```python
HEAD_KEYS = [
    ('size',  ['규격', '사이즈', 'size', 'type', '그룹', 'din', 'bci', 'jis']),
    ('model', ['품번', '모델', '형명', 'model', 'part', 'code']),
    ('ah',    ['c20', '용량', 'capacity', 'ah', '정격']),
    ('cca',   ['cca', 'cranking', '냉시동', 'sae', '(en']),
]
# 규격이나 품번이 있고 수치 열이 하나라도 있어야 제목 줄로 본다
```

## 10. 첫 명령은 "아무것도 안 하는" 확인이어야 한다

사용자 네트워크에서 **몇 개나 열리는지**를 1~2분에 알아야 그 다음을 정할 수 있다.
받지 않고 두드리기만 하는 모드를 만들고, HEAD 를 막는 서버가 많으니
400·401·403·405·501 이면 GET 으로 한 번 더 본다.

그리고 **`--dry`(목록만 출력)와 `--check`(실제로 두드림)를 헷갈리게 이름 짓지
마라.** `--dry` 는 아무 파일도 안 만드는데 그걸 "살아있는지 확인" 이라고 안내해서
사용자가 있지도 않은 결과 파일을 찾은 적이 있다.
