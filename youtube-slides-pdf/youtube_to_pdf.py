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
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from typing import List, Optional

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
def download_video(
    url: str,
    workdir: str,
    max_height: int = 720,
    log=None,
) -> str:
    """yt-dlp 로 영상을 내려받고 저장된 파일 경로를 반환한다.

    ffmpeg 없이도 동작하도록 '병합이 필요 없는 progressive mp4' 포맷을 우선한다.
    log(msg) 가 주어지면 진행 메시지를 그쪽으로도 보낸다.
    """
    if shutil.which("yt-dlp") is None:
        raise RuntimeError(
            "yt-dlp 가 설치되어 있지 않습니다.  pip install yt-dlp 로 설치하세요."
        )

    out_tmpl = os.path.join(workdir, "video.%(ext)s")
    fmt = (
        f"best[ext=mp4][height<={max_height}]/"
        f"best[height<={max_height}]/best"
    )
    cmd = [
        "yt-dlp",
        "-f", fmt,
        "--no-playlist",
        "--retries", "3",
        "-o", out_tmpl,
        url,
    ]
    msg = f"[1/3] 영상 다운로드 중 …  ({url})"
    print(msg)
    if log:
        log(msg)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            "영상 다운로드 실패:\n" + (result.stderr or result.stdout)
        )

    for name in os.listdir(workdir):
        if name.startswith("video."):
            path = os.path.join(workdir, name)
            print(f"      완료 → {name}")
            return path
    raise RuntimeError("다운로드된 영상 파일을 찾을 수 없습니다.")


# ---------------------------------------------------------------------------
# 2. 화면 변화 감지
# ---------------------------------------------------------------------------
def frame_signature(frame: "np.ndarray", size: int = 32) -> "np.ndarray":
    """프레임을 작은 블러 컬러 썸네일로 축약한 '지문'을 만든다.

    색상과 대략적 배치를 모두 담으므로, 이 지문들의 평균 절대차(MAD)를 비교하면
    구조만 보는 perceptual hash 와 달리 '배경색만 바뀐 슬라이드'도 잘 구분한다.
    반대로 발표자/webcam 오버레이처럼 화면 일부만 움직이는 변화는 값이 작아
    자연스럽게 무시된다.
    """
    small = cv2.resize(frame, (size, size), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (3, 3), 0)
    return small.astype(np.float32)


def signature_diff(a: "np.ndarray", b: "np.ndarray") -> float:
    """두 지문의 평균 절대차. 0(동일) ~ 100(완전히 다름) 스케일."""
    return float(np.abs(a - b).mean()) / 255.0 * 100.0


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
    settle_threshold: float = 2.0,
    start: float = 0.0,
    end: Optional[float] = None,
    add_timestamp: bool = True,
    progress=None,
) -> List[Slide]:
    """영상을 훑으며 새 슬라이드로 판단되는 프레임만 저장.

    change_threshold : 마지막 캡처와 이만큼(0~100) 이상 다르면 '변경'으로 간주.
    settle_threshold : 직전 샘플과 이 이하로 비슷하면 '화면이 안정됨'으로 간주.
    progress(frac, text, count) : 진행 상황 콜백(선택).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("영상을 열 수 없습니다: " + video_path)

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration = total / fps if fps else 0
    if end is None or end <= 0:
        end = duration
    print(
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
            img_path = _save_frame(
                frame, workdir, idx, t, add_timestamp
            )
            slides.append(Slide(time_sec=t, image_path=img_path))
            last_captured_sig = sig
            print(f"      + 슬라이드 {idx:02d}  @ {fmt_timestamp(t)}")

        if progress and end > start:
            frac = min(1.0, (t - start) / (end - start))
            progress(
                frac,
                f"분석 중  {fmt_timestamp(t)} / {fmt_timestamp(end)}",
                len(slides),
            )

        prev_sig = sig
        t += interval

    cap.release()
    print(f"      감지된 슬라이드: {len(slides)}장")
    return slides


def _save_frame(
    frame: "np.ndarray",
    workdir: str,
    idx: int,
    time_sec: float,
    add_timestamp: bool,
) -> str:
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    img = Image.fromarray(rgb)

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
    img.save(path, "JPEG", quality=90)
    return path


# ---------------------------------------------------------------------------
# 3. PDF 생성
# ---------------------------------------------------------------------------
def build_pdf(slides: List[Slide], output_path: str) -> None:
    if not slides:
        raise RuntimeError(
            "캡처된 슬라이드가 없습니다. --threshold 값을 낮추거나 "
            "--interval 을 줄여서 다시 시도해 보세요."
        )
    print(f"[3/3] PDF 생성 중 …  ({len(slides)}페이지)")
    image_paths = [s.image_path for s in slides]
    with open(output_path, "wb") as f:
        f.write(img2pdf.convert(image_paths))
    print(f"      완료 → {output_path}")


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
    settle_threshold: float = 2.0,
    start: float = 0.0,
    end: Optional[float] = None,
    max_height: int = 720,
    add_timestamp: bool = True,
    log=None,
    progress=None,
) -> List[Slide]:
    """source(URL 또는 로컬 경로)를 받아 슬라이드 PDF를 생성한다.

    다운로드 → 화면 변화 감지 → PDF 생성 전 과정을 한 번에 수행하며,
    CLI 와 웹 서버가 함께 사용한다.
    """
    if is_local:
        video_path = os.path.abspath(source)
        if not os.path.exists(video_path):
            raise RuntimeError("영상 파일을 찾을 수 없습니다: " + video_path)
        if log:
            log(f"[1/3] 로컬 영상 사용 → {video_path}")
    else:
        video_path = download_video(
            source, workdir, max_height=max_height, log=log
        )

    if log:
        log("[2/3] 화면 변화 감지 중 …")
    slides = detect_slides(
        video_path,
        workdir,
        interval=interval,
        change_threshold=change_threshold,
        settle_threshold=settle_threshold,
        start=start,
        end=end,
        add_timestamp=add_timestamp,
        progress=progress,
    )

    if log:
        log(f"[3/3] PDF 생성 중 … ({len(slides)}페이지)")
    build_pdf(slides, output_path)
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
        "--settle", type=float, default=2.0, dest="settle_threshold",
        help="화면이 '안정됨'으로 볼 최대 차이(0~100). 전환 애니메이션 무시용.",
    )
    p.add_argument("--start", type=float, default=0.0, help="시작 시각(초)")
    p.add_argument("--end", type=float, default=None, help="종료 시각(초)")
    p.add_argument("--max-height", type=int, default=720, help="다운로드 최대 화질(px)")
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


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    url = args.url
    if not url and not args.video:
        try:
            url = input("YouTube 영상 URL 을 입력하세요: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 1
    if not url and not args.video:
        print("URL 이 필요합니다.", file=sys.stderr)
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
        )

        if args.keep_images:
            os.makedirs(args.keep_images, exist_ok=True)
            for s in slides:
                shutil.copy2(
                    s.image_path,
                    os.path.join(args.keep_images, os.path.basename(s.image_path)),
                )
            print(f"      이미지 보관 → {args.keep_images}")

        print("\n✅ 완료!")
        return 0
    except (RuntimeError, KeyboardInterrupt) as e:
        print(f"\n[오류] {e}", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
