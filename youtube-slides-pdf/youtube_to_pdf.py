#!/usr/bin/env python3
"""
youtube_to_pdf — YouTube 강의 영상을 화면 변화(슬라이드 전환) 기준으로
자동 캡처하여 PDF로 만들어 주는 자동화 도구.

사용 예)
    python youtube_to_pdf.py "https://www.youtube.com/watch?v=XXXX"
    python youtube_to_pdf.py "URL" -o lecture.pdf --interval 1.0 --threshold 8

동작 개요
    1) yt-dlp 로 영상을 임시 폴더에 내려받는다.
    2) 영상을 --interval 초 간격으로 훑으면서 각 프레임의 perceptual hash(dHash)를
       계산한다.
    3) "직전 샘플과는 거의 같고(=화면이 안정됨) 마지막으로 캡처한 슬라이드와는
       충분히 다른" 순간만 새 슬라이드로 판단해 캡처한다.
       → 전환 애니메이션 중간 프레임, 말하는 사람만 움직이는 장면, 중복 슬라이드를
         걸러낸다.
    4) 캡처한 이미지들을 타임스탬프와 함께 한 장씩 PDF 페이지로 합친다.

의존성:  yt-dlp, opencv-python-headless, Pillow, img2pdf, numpy
    설치)  pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

# --- 서드파티 의존성 (없으면 친절히 안내) -------------------------------------
_MISSING = []
try:
    import cv2  # opencv-python-headless
except ImportError:
    _MISSING.append("opencv-python-headless")
try:
    import numpy as np
except ImportError:
    _MISSING.append("numpy")
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    _MISSING.append("Pillow")
try:
    import img2pdf
except ImportError:
    _MISSING.append("img2pdf")

if _MISSING:
    sys.stderr.write(
        "\n[!] 필요한 패키지가 없습니다: %s\n"
        "    다음 명령으로 설치하세요:\n"
        "        pip install -r requirements.txt\n"
        "    (또는  pip install %s)\n\n"
        % (", ".join(_MISSING), " ".join(_MISSING))
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# 1. 영상 다운로드
# ---------------------------------------------------------------------------
@dataclass
class Download:
    """다운로드 결과.

    time_offset : 구간 다운로드를 쓴 경우, 받아진 파일의 0초가 원본 영상의 몇 초에
                  해당하는지.  슬라이드 시각을 원본 기준으로 되돌리는 데 쓴다.
    sectioned   : 구간 다운로드가 실제로 적용됐는지.  start=0 인 구간(예: 0~300초)은
                  time_offset 이 0 이라 오프셋만으로는 구분할 수 없어 따로 둔다.
    """
    path: str
    time_offset: float = 0.0
    sectioned: bool = False
    title: Optional[str] = None


# yt-dlp 진행률을 파싱하기 쉬운 전용 라인으로 뽑아내기 위한 템플릿.
_DLPROG = "__DLPROG__"
_PROGRESS_TEMPLATE = (
    "download:" + _DLPROG
    + "|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s"
)

# 쿠키 안내 — 클라우드에서 막혔을 때 사용자가 취할 다음 행동.
_COOKIE_HINT = (
    "→ 쿠키 파일(환경변수 YTDLP_COOKIES)을 설정하면 대부분 해결됩니다. "
    "DEPLOY.md 3단계를 참고하세요."
)


def _safe_print(message: str = "", file=None) -> None:
    """콘솔이 못 쓰는 글자가 있어도 죽지 않게 출력한다.

    한국어 윈도우의 기본 콘솔 인코딩은 cp949 인데, 여기에는 '—'(em dash) 같은
    글자가 없다.  그냥 print 하면 UnicodeEncodeError 로 프로그램이 통째로 죽는다.
    (실제로 다운로드 재시도 메시지에서 터졌다.  콘솔이 UTF-8 인 환경에서는
     드러나지 않아서 더 위험하다.)
    """
    stream = file or sys.stdout
    try:
        print(message, file=stream)
    except UnicodeEncodeError:
        encoding = getattr(stream, "encoding", None) or "utf-8"
        print(message.encode(encoding, "replace").decode(encoding, "replace"),
              file=stream)


def _env_float(name: str, default: float) -> float:
    """환경변수를 양수 float 으로 읽는다. 비었거나 잘못됐으면 기본값."""
    try:
        value = float(os.environ.get(name) or default)
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def _parse_dlprog(line: str):
    """`_DLPROG` 진행률 라인을 (퍼센트, 속도, ETA) 로 파싱. 아니면 None."""
    if not line.startswith(_DLPROG):
        return None
    parts = line.split("|")
    raw_pct = parts[1].strip() if len(parts) > 1 else ""
    speed = parts[2].strip() if len(parts) > 2 else ""
    eta = parts[3].strip() if len(parts) > 3 else ""

    pct = None
    if raw_pct.endswith("%"):
        try:  # 크기를 모르는 스트림은 'N/A' 가 오기도 한다.
            pct = min(100.0, max(0.0, float(raw_pct[:-1])))
        except ValueError:
            pct = None
    return pct, (speed or "속도 미상"), (eta or "미상")


def _section_spec(start: float, end: Optional[float]) -> Optional[str]:
    """--download-sections 인자. 구간 지정이 없으면 None."""
    has_start = bool(start and start > 0)
    has_end = end is not None and end > 0
    if not has_start and not has_end:
        return None
    tail = f"{float(end):.3f}" if has_end else "inf"
    return f"*{float(start or 0):.3f}-{tail}"


def _ytdlp_bin() -> Optional[List[str]]:
    """yt-dlp 실행 명령(인자 리스트). 찾지 못하면 None.

    환경변수 YTDLP_BIN 으로 직접 지정할 수 있다(PATH 에 없는 설치 경로·테스트용).
    경로 하나를 주거나, 인자까지 포함해야 하면 JSON 배열을 준다.
        YTDLP_BIN=/opt/bin/yt-dlp
        YTDLP_BIN=["python","-m","yt_dlp"]
    """
    override = os.environ.get("YTDLP_BIN")
    if override:
        override = override.strip()
        if override.startswith("["):
            try:
                parsed = json.loads(override)
            except ValueError:
                return None
            return [str(x) for x in parsed] if parsed else None
        return [override] if os.path.exists(override) else None

    found = shutil.which("yt-dlp")
    if found:
        return [found]

    # 윈도우에서는 pip 가 yt-dlp.exe 를 PATH 밖(Scripts 폴더)에 두는 일이 흔하다.
    # 그럴 때도 모듈로는 멀쩡히 돌아가므로 그쪽으로 실행한다.
    try:
        import importlib.util
        if importlib.util.find_spec("yt_dlp") is not None:
            return [sys.executable, "-m", "yt_dlp"]
    except Exception:
        pass
    return None


# yt-dlp 가 요구하는 최소 버전 (https://github.com/yt-dlp/yt-dlp/wiki/EJS).
# 버전이 모자라면 yt-dlp 가 '지원되는 런타임 없음'으로 무시해 버리므로, 넘기기 전에
# 우리가 먼저 걸러야 한다.  실제로 Debian 의 nodejs 는 18 이라 그냥 넘기면 실패한다.
_JS_RUNTIME_MIN = {
    "deno": (2, 0, 0),
    "node": (22, 0, 0),
    "bun": (1, 2, 11),
}
_JS_RUNTIME_CACHE: List[Optional[str]] = []


def _runtime_version(binary: str) -> Optional[tuple]:
    """`<binary> --version` 출력에서 (major, minor, patch) 를 뽑는다."""
    try:
        out = subprocess.run(
            [binary, "--version"], capture_output=True, text=True,
            timeout=20, encoding="utf-8", errors="replace",
        )
    except Exception:
        return None
    text = (out.stdout or "") + (out.stderr or "")
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", text)
    return tuple(int(g) for g in match.groups()) if match else None


def _js_runtime(ytdlp: List[str]) -> Optional[str]:
    """yt-dlp 에 넘길 JavaScript 런타임 이름. 못 찾거나 불필요하면 None.

    요즘 yt-dlp 는 YouTube 의 서명을 풀기 위해 JS 런타임이 필요하다.  없으면
    포맷을 못 얻거나 다운로드가 `HTTP Error 403: Forbidden` 으로 실패한다.
    기본으로 켜져 있는 건 deno 뿐이라, node/bun 이 있으면 명시해 줘야 한다.

    결과는 캐시한다(프로세스당 한 번만 조사).
    """
    if _JS_RUNTIME_CACHE:
        return _JS_RUNTIME_CACHE[0]

    found: Optional[str] = None
    override = os.environ.get("YTDLP_JS_RUNTIME")
    if override:
        found = override          # 직접 지정했으면 그대로 믿는다
    else:
        for name, minimum in _JS_RUNTIME_MIN.items():
            path = shutil.which(name)
            if not path:
                continue
            version = _runtime_version(path)
            if version is None or version >= minimum:
                found = name       # 버전을 못 읽으면 일단 써 본다
                break
            _safe_print(
                f"      [주의] {name} {'.'.join(map(str, version))} 은 너무 낮습니다 "
                f"(yt-dlp 는 {'.'.join(map(str, minimum))} 이상 필요). 건너뜁니다."
            )

    # 구버전 yt-dlp 에는 --js-runtimes 가 없다.  넘기면 그대로 죽으므로 먼저 확인.
    if found:
        try:
            help_text = subprocess.run(
                ytdlp + ["--help"], capture_output=True, text=True,
                timeout=30, encoding="utf-8", errors="replace",
            ).stdout or ""
            if "--js-runtimes" not in help_text:
                found = None
        except Exception:
            found = None

    _JS_RUNTIME_CACHE.append(found)
    return found


def _kill(proc: "subprocess.Popen") -> None:
    """멈춘 yt-dlp 를 확실히 정리한다(좀비 방지)."""
    try:
        proc.kill()
    except Exception:
        pass
    try:
        proc.wait(timeout=10)
    except Exception:
        pass


def download_video(
    url: str,
    workdir: str,
    max_height: int = 720,
    log=None,
    progress=None,
    start: float = 0.0,
    end: Optional[float] = None,
) -> Download:
    """yt-dlp 로 영상을 내려받고 결과(경로·시각 오프셋)를 반환한다.

    ffmpeg 없이도 동작하도록 '병합이 필요 없는 progressive mp4' 포맷을 우선한다.
    log(msg) / progress(frac, text, count) 가 주어지면 진행 상황을 그쪽으로 보낸다.

    블로킹 호출이 아니라 출력을 한 줄씩 읽으며 진행률을 보고하고, 두 종류의
    타임아웃으로 '아무 반응 없이 영원히 매달리는' 상태를 막는다.
      YTDLP_STALL_TIMEOUT (기본 180초) : 출력이 이만큼 끊기면 중단
      YTDLP_TIMEOUT       (기본 1200초): 전체 소요가 이를 넘으면 중단
    """
    ytdlp = _ytdlp_bin()
    if ytdlp is None:
        raise RuntimeError(
            "yt-dlp 가 설치되어 있지 않습니다.  pip install yt-dlp 로 설치하세요."
        )

    def emit(message: str) -> None:
        _safe_print(message)
        if log:
            log(message)

    out_tmpl = os.path.join(workdir, "video.%(ext)s")
    fmt = (
        f"best[ext=mp4][height<={max_height}]/"
        f"best[height<={max_height}]/best"
    )
    cmd = ytdlp + [
        "-f", fmt,
        "--no-playlist",
        "--retries", "3",
        "--socket-timeout", str(int(_env_float("YTDLP_SOCKET_TIMEOUT", 20))),
        "--newline",
        "--progress-template", _PROGRESS_TEMPLATE,
        # 제목을 얻으려고 따로 네트워크 요청을 하지 않도록, 받는 김에 같이 저장한다.
        "--write-info-json",
        "-o", out_tmpl,
    ]
    runtime = _js_runtime(ytdlp)
    if runtime:
        cmd += ["--js-runtimes", runtime]
    else:
        emit("      [주의] JavaScript 런타임(deno/node/bun)이 없어 403 으로 실패할 수 "
             "있습니다. Dockerfile 은 nodejs 를 설치합니다.")

    # 클라우드 서버는 YouTube 가 IP 를 막는 경우가 많다.  쿠키 파일이 주어지면
    # (환경변수 YTDLP_COOKIES) 로그인 세션으로 우회한다.
    cookies = os.environ.get("YTDLP_COOKIES")
    if cookies and os.path.exists(cookies):
        cmd += ["--cookies", cookies]

    # --- 구간 다운로드: 지정 구간만 받아 시간과 스로틀 노출을 줄인다 -------------
    time_offset, sectioned = 0.0, False
    section = _section_spec(start, end)
    if section:
        if os.environ.get("YTDLP_NO_SECTIONS") == "1":
            emit("      구간 다운로드가 꺼져 있어(YTDLP_NO_SECTIONS=1) 전체를 받습니다.")
        elif shutil.which("ffmpeg") is None:
            emit("      ffmpeg 이 없어 구간 다운로드를 건너뜁니다 → 전체를 받습니다.")
        else:
            # --force-keyframes-at-cuts 때문에 실제 시작이 몇 초 앞당겨질 수 있으나
            # 슬라이드 감지에는 영향이 없어 허용 오차로 둔다.
            cmd += ["--download-sections", section, "--force-keyframes-at-cuts"]
            time_offset, sectioned = float(start or 0), True
            emit(
                f"      구간만 받습니다: {fmt_timestamp(float(start or 0))} ~ "
                + (fmt_timestamp(float(end)) if end and end > 0 else "끝")
            )
    cmd.append(url)

    emit(f"[1/3] 영상 다운로드 중 …  ({url})")

    # YouTube 는 같은 요청에도 간헐적으로 403 을 낸다(실측: 실패 직후 3회 연속 성공).
    # 그래서 실패하면 몇 번 다시 시도한다.  타임아웃은 이미 오래 기다린 뒤라 재시도하지 않는다.
    attempts = max(1, int(_env_float("YTDLP_ATTEMPTS", 3)))
    rc, tail = 1, []
    for attempt in range(1, attempts + 1):
        rc, tail = _run_ytdlp(cmd, emit, log, progress)
        if rc == 0:
            break
        if attempt < attempts:
            emit(f"      다운로드 실패 — 다시 시도합니다 ({attempt}/{attempts - 1})")
            time.sleep(3)

    if rc != 0:
        err = "\n".join(tail).strip() or "(yt-dlp 가 출력을 남기지 않았습니다)"
        if "403" in err or "JavaScript runtime" in err:
            err += (
                "\n\n※ YouTube 서명을 풀지 못했습니다. JavaScript 런타임이 필요합니다.\n"
                "→ 서버에 node(또는 deno)를 설치하세요. "
                "이미 있다면 YTDLP_JS_RUNTIME=node 로 지정할 수 있습니다.\n"
                "→ yt-dlp 가 오래됐을 수도 있습니다: pip install -U yt-dlp"
            )
        if "Sign in to confirm" in err or "bot" in err.lower():
            err += (
                "\n\n※ YouTube 가 서버 IP 를 차단한 것 같습니다.\n" + _COOKIE_HINT
            )
        raise RuntimeError("영상 다운로드 실패:\n" + err)

    title = None
    info_path = os.path.join(workdir, "video.info.json")
    if os.path.exists(info_path):
        try:
            with open(info_path, encoding="utf-8") as f:
                title = (json.load(f).get("title") or "").strip() or None
        except Exception:
            pass

    for name in sorted(os.listdir(workdir)):
        # .part/.ytdl/.info.json 은 영상 파일이 아니므로 제외한다.
        if name.startswith("video.") and not name.endswith(
            (".part", ".ytdl", ".json")
        ):
            _safe_print(f"      완료 → {name}")
            return Download(
                path=os.path.join(workdir, name),
                time_offset=time_offset,
                sectioned=sectioned,
                title=title,
            )
    raise RuntimeError("다운로드된 영상 파일을 찾을 수 없습니다.")


def _run_ytdlp(cmd: List[str], emit, log, progress) -> Tuple[int, List[str]]:
    """yt-dlp 를 한 번 실행하며 진행률을 보고한다. (종료코드, 마지막 출력)

    출력을 한 줄씩 읽어 두 종류의 타임아웃을 감시한다.  타임아웃이면 예외를 던진다.
    """
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        encoding="utf-8",
        errors="replace",
    )

    # 리더 스레드가 라인을 큐에 넣고, 본 루프가 두 데드라인을 함께 감시한다.
    lines: "queue.Queue" = queue.Queue()

    def reader() -> None:
        try:
            for raw in proc.stdout:  # type: ignore[union-attr]
                lines.put(raw.rstrip("\r\n"))
        except Exception:
            pass
        finally:
            lines.put(None)

    threading.Thread(target=reader, daemon=True).start()

    stall_limit = _env_float("YTDLP_STALL_TIMEOUT", 180.0)
    hard_limit = _env_float("YTDLP_TIMEOUT", 1200.0)
    began = time.monotonic()
    tail: List[str] = []          # 실패 시 보여줄 마지막 출력
    last_pct, last_report = -1.0, 0.0

    while True:
        elapsed = time.monotonic() - began
        if elapsed >= hard_limit:
            _kill(proc)
            raise RuntimeError(
                f"영상 다운로드가 {int(hard_limit)}초를 넘겨 중단했습니다.\n"
                "영상이 너무 길거나 YouTube 가 이 서버의 다운로드를 제한하고 있습니다.\n"
                "→ 고급 옵션에서 시작/끝 구간을 나눠 처리해 보세요.\n"
                + _COOKIE_HINT
            )
        try:
            line = lines.get(timeout=min(stall_limit, hard_limit - elapsed))
        except queue.Empty:
            _kill(proc)
            raise RuntimeError(
                f"영상 다운로드가 {int(stall_limit)}초 동안 전혀 진행되지 않아 중단했습니다.\n"
                "YouTube 가 이 서버 IP 의 다운로드를 제한하는 것으로 보입니다.\n"
                + _COOKIE_HINT
            )
        if line is None:
            break

        parsed = _parse_dlprog(line)
        if parsed is None:
            if line.strip():
                tail.append(line)
                del tail[:-40]
                if log:
                    log(line)
            continue

        pct, speed, eta = parsed
        now = time.monotonic()
        # 초당 수십 번 이벤트를 쏘지 않도록: 1% 이상 변했거나 1초 이상 지났을 때만.
        if pct is None or pct - last_pct >= 1.0 or now - last_report >= 1.0:
            last_report = now
            if pct is None:
                text = f"다운로드 중  ·  {speed}"
            else:
                last_pct = pct
                text = f"다운로드 중  {pct:.1f}%  ·  {speed}  ·  남은시간 {eta}"
            if progress:
                progress((pct or 0.0) / 100.0, text, 0)
            elif log:
                log(text)

    rc = proc.wait()
    if rc == 0 and progress and last_report:
        # 진행바를 100% 로 닫아 다음 단계와 겹치지 않게
        progress(1.0, "다운로드 중  100.0%  ·  완료", 0)
    return rc, tail


# ---------------------------------------------------------------------------
# 2. 화면 변화 감지
# ---------------------------------------------------------------------------
# 지문 파라미터.  합성 슬라이드(글머리표·코드·차트·사진) × 3개 해상도 × 압축 잡음
# 조합에서 '발표자만 움직임'과 '슬라이드 전환'이 확실히 갈리도록 실측해 정한 값들이다.
_INK_GRID, _INK_BLUR = 96, 5
_INK_FLOOR, _INK_REL, _INK_SCALE = 14.0, 0.35, 3.6
_REGION_GRID, _REGION_DELTA, _REGION_SCALE = 64, 12.0, 26.0


@dataclass
class Signature:
    """한 프레임을 세 가지 관점으로 축약한 '지문'."""
    color: "np.ndarray"      # 32x32 블러 컬러 — 배경·테마 변화
    ink: "np.ndarray"        # 96x96 윤곽 밀도 — 글자/코드 변화
    region: "np.ndarray"     # 64x64 컬러 — 그림·도표처럼 넓은 면이 바뀌는 변화


def frame_signature(frame: "np.ndarray", size: int = 32) -> Signature:
    """프레임에서 세 채널짜리 지문을 뽑는다.

    한 채널만으로는 강의 화면을 못 가린다.
      color  : 배경색·테마가 통째로 바뀌는 전환에 강하지만, 흰 배경에 글자만
               바뀌는 전환은 32x32 로 줄이는 순간 글자가 묻혀 전혀 못 잡는다.
      ink    : 그래서 윤곽(라플라시안) 밀도를 따로 본다.  글자·코드가 바뀌면
               '잉크가 있는 칸'의 분포가 달라진다.  압축 잡음에 흔들리지 않도록
               잉크가 옅은 칸(_INK_FLOOR 미만)은 세지 않는다.
      region : 막대그래프·사진처럼 넓은 면이 바뀌는 경우는 윤곽이 거의 안 변한다.
               칸 단위 색 변화를 보되, 그 변화가 화면 전체에 '퍼져 있는지'를 함께
               따져서 한쪽 구석만 움직이는 발표자 오버레이와 구분한다.
    """
    color = cv2.GaussianBlur(
        cv2.resize(frame, (size, size), interpolation=cv2.INTER_AREA), (3, 3), 0
    ).astype(np.float32)

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = np.abs(
        cv2.Laplacian(cv2.GaussianBlur(gray, (_INK_BLUR, _INK_BLUR), 0), cv2.CV_32F)
    )
    ink = cv2.resize(edges, (_INK_GRID, _INK_GRID), interpolation=cv2.INTER_AREA)

    region = cv2.resize(
        frame, (_REGION_GRID, _REGION_GRID), interpolation=cv2.INTER_AREA
    ).astype(np.float32)

    return Signature(color=color, ink=ink, region=region)


def signature_diff(a: Signature, b: Signature) -> float:
    """두 지문의 차이. 0(동일) ~ 100(완전히 다름) 스케일.

    세 채널 중 '가장 크게 반응한 것'을 쓴다.  어느 하나라도 뚜렷이 달라졌다면
    슬라이드가 넘어간 것이기 때문이다.
    """
    color = float(np.abs(a.color - b.color).mean()) / 255.0 * 100.0

    scale = np.maximum(np.maximum(a.ink, b.ink), _INK_FLOOR)
    ink = float((np.abs(a.ink - b.ink) / scale > _INK_REL).mean()) * 100.0 * _INK_SCALE

    changed = np.abs(a.region - b.region).mean(axis=2) > _REGION_DELTA
    fraction = float(changed.mean())
    region = 0.0
    if fraction:
        # 변화가 몇 줄·몇 칸에 걸쳐 퍼져 있나. 구석의 발표자 오버레이는 작게 나온다.
        spread = float(changed.any(axis=1).mean()) * float(changed.any(axis=0).mean())
        region = fraction * spread * 100.0 * _REGION_SCALE

    return min(100.0, max(color, ink, region))


def fmt_timestamp(seconds: float) -> str:
    s = int(round(seconds))
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


@dataclass
class Slide:
    time_sec: float
    image_path: str


def detect_slides(
    video_path: str,
    workdir: str,
    interval: float = 1.0,
    change_threshold: float = 8.0,
    settle_threshold: float = 2.8,
    start: float = 0.0,
    end: Optional[float] = None,
    add_timestamp: bool = True,
    progress=None,
    time_offset: float = 0.0,
    max_width: int = 1600,
    quality: int = 80,
) -> List[Slide]:
    """영상을 훑으며 새 슬라이드로 판단되는 프레임만 저장.

    change_threshold : 마지막 캡처와 이만큼(0~100) 이상 다르면 '변경'으로 간주.
    settle_threshold : 직전 샘플과 이 이하로 비슷하면 '화면이 안정됨'으로 간주.
    progress(frac, text, count) : 진행 상황 콜백(선택).
    time_offset : 구간 다운로드로 잘라낸 파일이면, 표시·기록할 시각에 더할 값.
                  (파일 시각 0 = 원본 시각 time_offset)
    max_width / quality : 저장할 슬라이드 이미지의 크기·화질(=PDF 용량) 조절.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("영상을 열 수 없습니다: " + video_path)

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration = total / fps if fps else 0
    if end is None or end <= 0:
        end = duration
    _safe_print(
        f"[2/3] 화면 변화 감지 중 …  (길이 {fmt_timestamp(duration)}, "
        f"{interval}s 간격 샘플링)"
    )

    slides: List[Slide] = []
    prev_sig: Optional["np.ndarray"] = None
    last_captured_sig: Optional["np.ndarray"] = None
    idx = 0
    t = start

    while t <= end:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            break

        sig = frame_signature(frame)

        settled = (
            prev_sig is None
            or signature_diff(sig, prev_sig) <= settle_threshold
        )
        changed = (
            last_captured_sig is None
            or signature_diff(sig, last_captured_sig) >= change_threshold
        )

        if settled and changed:
            idx += 1
            abs_t = t + time_offset
            img_path = _save_frame(
                frame, workdir, idx, abs_t, add_timestamp,
                max_width=max_width, quality=quality,
            )
            slides.append(Slide(time_sec=abs_t, image_path=img_path))
            last_captured_sig = sig
            _safe_print(f"      + 슬라이드 {idx:02d}  @ {fmt_timestamp(abs_t)}")

        if progress and end > start:
            frac = min(1.0, (t - start) / (end - start))
            progress(
                frac,
                f"분석 중  {fmt_timestamp(t + time_offset)} / "
                f"{fmt_timestamp(end + time_offset)}",
                len(slides),
            )

        prev_sig = sig
        t += interval

    cap.release()
    _safe_print(f"      감지된 슬라이드: {len(slides)}장")
    return slides


def _save_frame(
    frame: "np.ndarray",
    workdir: str,
    idx: int,
    time_sec: float,
    add_timestamp: bool,
    max_width: int = 1600,
    quality: int = 80,
) -> str:
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    img = Image.fromarray(rgb)

    # PDF 용량은 사실상 이 이미지들의 합이다.  강의 슬라이드는 글자만 읽히면 되므로
    # 가로 폭을 제한해 두면 화질 체감 손해 없이 용량이 크게 준다.
    if max_width and img.width > max_width:
        height = max(1, round(img.height * max_width / img.width))
        img = img.resize((max_width, height), Image.LANCZOS)

    if add_timestamp:
        draw = ImageDraw.Draw(img)
        label = fmt_timestamp(time_sec)
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", size=22)
        except Exception:
            font = ImageFont.load_default()
        pad = 8
        try:
            l, top, r, bottom = draw.textbbox((0, 0), label, font=font)
            tw, th = r - l, bottom - top
        except Exception:
            tw, th = draw.textsize(label, font=font)
        x, y = 10, img.height - th - 2 * pad - 10
        draw.rectangle(
            [x, y, x + tw + 2 * pad, y + th + 2 * pad],
            fill=(0, 0, 0),
        )
        draw.text((x + pad, y + pad), label, fill=(255, 255, 255), font=font)

    path = os.path.join(workdir, f"slide_{idx:03d}.jpg")
    # optimize=True 는 화질 손실 없이 허프만 테이블을 다시 짜 몇 % 를 더 줄인다.
    img.save(path, "JPEG", quality=quality, optimize=True)
    return path


# ---------------------------------------------------------------------------
# 3. PDF 생성
# ---------------------------------------------------------------------------
# 용량 목표를 못 맞췄을 때 차례로 시도할 (가로폭, JPEG 화질) 단계.
# 강의 슬라이드는 글자 가독성만 지키면 되므로 이 정도까지는 실용적으로 안전하다.
_SHRINK_STEPS: List[Tuple[int, int]] = [
    (1280, 72), (1100, 65), (960, 58), (800, 50),
]


def _mb(path: str) -> float:
    return os.path.getsize(path) / (1024 * 1024)


def _write_pdf(image_paths: List[str], output_path: str) -> None:
    with open(output_path, "wb") as f:
        f.write(img2pdf.convert(image_paths))


def _shrink(src_paths: List[str], workdir: str, width: int, quality: int) -> List[str]:
    """슬라이드 이미지를 더 작은 폭·화질로 다시 인코딩한 사본 경로들을 만든다."""
    out = []
    subdir = os.path.join(workdir, f"shrunk_{width}_{quality}")
    os.makedirs(subdir, exist_ok=True)
    for src in src_paths:
        img = Image.open(src)
        if img.width > width:
            height = max(1, round(img.height * width / img.width))
            img = img.resize((width, height), Image.LANCZOS)
        dst = os.path.join(subdir, os.path.basename(src))
        img.save(dst, "JPEG", quality=quality, optimize=True)
        out.append(dst)
    return out


def build_pdf(
    slides: List[Slide],
    output_path: str,
    max_mb: Optional[float] = None,
    log=None,
) -> None:
    """슬라이드 이미지들을 PDF 한 권으로 묶는다.

    max_mb 가 주어지면 그 용량 이하가 될 때까지 이미지를 단계적으로 줄여 다시 만든다.
    (마지막 단계로도 못 맞추면 가장 작은 결과를 남기고 경고한다.)
    """
    if not slides:
        raise RuntimeError(
            "캡처된 슬라이드가 없습니다. --threshold 값을 낮추거나 "
            "--interval 을 줄여서 다시 시도해 보세요."
        )

    def emit(message: str) -> None:
        _safe_print(message)
        if log:
            log(message)

    emit(f"[3/3] PDF 생성 중 …  ({len(slides)}페이지)")
    image_paths = [s.image_path for s in slides]
    _write_pdf(image_paths, output_path)

    if max_mb and max_mb > 0:
        workdir = os.path.dirname(image_paths[0])
        for width, quality in _SHRINK_STEPS:
            size = _mb(output_path)
            if size <= max_mb:
                break
            emit(
                f"      용량 {size:.1f}MB > 목표 {max_mb:.1f}MB "
                f"→ {width}px / 화질 {quality} 로 다시 만듭니다."
            )
            _write_pdf(_shrink(image_paths, workdir, width, quality), output_path)
        if _mb(output_path) > max_mb:
            emit(
                f"      [주의] 최소 설정으로도 {_mb(output_path):.1f}MB 입니다 "
                f"(목표 {max_mb:.1f}MB). 슬라이드 수가 많으면 구간을 나눠 보세요."
            )

    emit(f"      완료 → {output_path}  ({_mb(output_path):.1f}MB)")


# ---------------------------------------------------------------------------
# 상위 오케스트레이션 (CLI · 서버 공용)
# ---------------------------------------------------------------------------
def generate(
    source: str,
    output_path: str,
    workdir: str,
    *,
    is_local: bool = False,
    interval: float = 1.0,
    change_threshold: float = 8.0,
    settle_threshold: float = 2.8,
    start: float = 0.0,
    end: Optional[float] = None,
    max_height: int = 720,
    add_timestamp: bool = True,
    max_width: int = 1600,
    quality: int = 80,
    max_mb: Optional[float] = None,
    info: Optional[dict] = None,
    log=None,
    progress=None,
) -> List[Slide]:
    """source(URL 또는 로컬 경로)를 받아 슬라이드 PDF를 생성한다.

    다운로드 → 화면 변화 감지 → PDF 생성 전 과정을 한 번에 수행하며,
    CLI 와 웹 서버가 함께 사용한다.
    """
    # 구간 다운로드를 쓰면 받아진 파일이 0초부터 시작하므로, 분석 구간은 0 기준으로
    # 다시 잡고 슬라이드 시각만 원본 기준으로 되돌린다(time_offset).
    detect_start, detect_end, time_offset = start, end, 0.0

    if is_local:
        video_path = os.path.abspath(source)
        if not os.path.exists(video_path):
            raise RuntimeError("영상 파일을 찾을 수 없습니다: " + video_path)
        if log:
            log(f"[1/3] 로컬 영상 사용 → {video_path}")
    else:
        dl = download_video(
            source, workdir, max_height=max_height, log=log,
            progress=progress, start=start, end=end,
        )
        video_path = dl.path
        if info is not None and dl.title:
            info["title"] = dl.title      # 호출자가 PDF 파일명으로 쓸 수 있게
        if dl.sectioned:
            time_offset = dl.time_offset
            detect_start = 0.0
            detect_end = (
                None if (end is None or end <= 0) else max(0.0, end - start)
            )

    if log:
        log("[2/3] 화면 변화 감지 중 …")
    slides = detect_slides(
        video_path,
        workdir,
        interval=interval,
        change_threshold=change_threshold,
        settle_threshold=settle_threshold,
        start=detect_start,
        end=detect_end,
        add_timestamp=add_timestamp,
        progress=progress,
        time_offset=time_offset,
        max_width=max_width,
        quality=quality,
    )

    build_pdf(slides, output_path, max_mb=max_mb, log=log)
    return slides


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="YouTube 강의 영상을 화면 변화 기준으로 캡처하여 PDF로 만듭니다.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("url", nargs="?", help="YouTube 영상 URL")
    p.add_argument("-o", "--output", default="slides.pdf", help="출력 PDF 파일 경로")
    p.add_argument(
        "--interval", type=float, default=1.0,
        help="프레임 샘플링 간격(초). 작을수록 촘촘하지만 느립니다.",
    )
    p.add_argument(
        "--threshold", type=float, default=8.0, dest="change_threshold",
        help="슬라이드 변경으로 볼 최소 차이(0~100). 낮추면 더 민감.",
    )
    p.add_argument(
        # 저해상도(480p) 영상에서 발표자 웹캠 오버레이가 움직이면 실측 2.15 까지
        # 나오므로, 2.0 으로 두면 '안정' 판정이 안 나 캡처가 통째로 막힌다.
        # 서버 UI 의 민감도 '보통' 과 같은 값(threshold*0.35)으로 맞춘다.
        "--settle", type=float, default=2.8, dest="settle_threshold",
        help="화면이 '안정됨'으로 볼 최대 차이(0~100). 전환 애니메이션 무시용.",
    )
    p.add_argument("--start", type=float, default=0.0, help="시작 시각(초)")
    p.add_argument("--end", type=float, default=None, help="종료 시각(초)")
    p.add_argument("--max-height", type=int, default=720, help="다운로드 최대 화질(px)")
    p.add_argument(
        "--max-width", type=int, default=1600,
        help="슬라이드 이미지 최대 가로폭(px). 줄이면 PDF 용량이 줄어듭니다.",
    )
    p.add_argument(
        "--quality", type=int, default=80,
        help="슬라이드 JPEG 화질(1~95). 낮출수록 PDF 가 가벼워집니다.",
    )
    p.add_argument(
        "--max-mb", type=float, default=None, metavar="MB",
        help="PDF 목표 용량(MB). 넘으면 이미지를 단계적으로 줄여 다시 만듭니다.",
    )
    p.add_argument(
        "--no-timestamp", action="store_true",
        help="각 슬라이드에 타임스탬프를 넣지 않습니다.",
    )
    p.add_argument(
        "--keep-images", metavar="DIR",
        help="캡처한 원본 이미지를 이 폴더에 함께 보관합니다.",
    )
    p.add_argument(
        "--video", metavar="PATH",
        help="다운로드 대신 로컬 영상 파일을 사용합니다.",
    )
    return p.parse_args(argv)


def _console_progress(frac: float, text: str, count: int) -> None:
    """CLI 용 진행 표시.

    다운로드 단계만 한 줄을 덮어쓰며 갱신한다.  분석 단계는 이미 슬라이드마다
    '+ 슬라이드 NN' 을 출력하므로, 여기서 또 그리면 서로 뒤엉킨다.
    """
    if not text.startswith("다운로드 중"):
        return
    sys.stdout.write("\r      " + text.ljust(64)[:78])
    sys.stdout.flush()
    if frac >= 1.0:
        sys.stdout.write("\n")


def main(argv: Optional[List[str]] = None) -> int:
    # cp949 콘솔에서 못 쓰는 글자 때문에 죽지 않게(표시만 '?' 가 된다).
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    args = parse_args(argv)

    url = args.url
    if not url and not args.video:
        try:
            url = input("YouTube 영상 URL 을 입력하세요: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 1
    if not url and not args.video:
        _safe_print("URL 이 필요합니다.", file=sys.stderr)
        return 1

    workdir = tempfile.mkdtemp(prefix="yt2pdf_")
    try:
        slides = generate(
            args.video if args.video else url,
            args.output,
            workdir,
            is_local=bool(args.video),
            interval=args.interval,
            change_threshold=args.change_threshold,
            settle_threshold=args.settle_threshold,
            start=args.start,
            end=args.end,
            max_height=args.max_height,
            add_timestamp=not args.no_timestamp,
            max_width=args.max_width,
            quality=args.quality,
            max_mb=args.max_mb,
            progress=_console_progress,
        )

        if args.keep_images:
            os.makedirs(args.keep_images, exist_ok=True)
            for s in slides:
                shutil.copy2(
                    s.image_path,
                    os.path.join(args.keep_images, os.path.basename(s.image_path)),
                )
            _safe_print(f"      이미지 보관 → {args.keep_images}")

        _safe_print("\n✅ 완료!")
        return 0
    except (RuntimeError, KeyboardInterrupt) as e:
        _safe_print(f"\n[오류] {e}", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
