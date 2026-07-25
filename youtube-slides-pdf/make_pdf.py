#!/usr/bin/env python3
"""PC 에서 더블클릭으로 쓰는 진입점.

주소를 물어보고, PDF 를 바탕화면에 만들고, 다 되면 폴더를 열어 준다.
터미널을 모르는 사람도 쓸 수 있게 하는 게 목적이라 옵션은 최소로 둔다.

    make-pdf.bat                       ← 더블클릭 (주소를 물어봄)
    python make_pdf.py "URL"           ← 주소를 바로 주기
    python make_pdf.py "URL" --light   ← 가벼운 PDF 로
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# 화면 크기·화질 프리셋 — 웹 UI 의 '가볍게 / 보통 / 선명하게' 와 같은 값.
PRESETS = {
    "light": (1100, 62, 5.0),
    "normal": (1600, 80, 15.0),
    "sharp": (1920, 90, None),
}


def desktop_dir() -> str:
    """바탕화면 경로. 못 찾으면 홈 폴더."""
    candidates = [
        os.path.join(os.path.expanduser("~"), "Desktop"),
        os.path.join(os.path.expanduser("~"), "바탕 화면"),
        os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop"),
        os.path.join(os.path.expanduser("~"), "OneDrive", "바탕 화면"),
    ]
    for path in candidates:
        if os.path.isdir(path):
            return path
    return os.path.expanduser("~")


def safe_name(title: str) -> str:
    for ch in '\\/:*?"<>|\r\n\t':
        title = title.replace(ch, " ")
    return " ".join(title.split())[:80].strip(" .")


def open_folder(path: str) -> None:
    try:
        if sys.platform == "win32":
            os.startfile(os.path.dirname(path))  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.run(["open", "-R", path], check=False)
        else:
            subprocess.run(["xdg-open", os.path.dirname(path)], check=False)
    except Exception:
        pass


def main() -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("url", nargs="?")
    ap.add_argument("--light", action="store_true", help="가벼운 PDF")
    ap.add_argument("--sharp", action="store_true", help="선명한 PDF(용량 큼)")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=0.0)
    args = ap.parse_args()

    # 한국어 윈도우 콘솔은 cp949 라서 '✅' 같은 글자를 못 찍고 죽는다.
    # errors="replace" 로 두면 표시만 '?' 가 되고 프로그램은 살아남는다.
    # (bat 이 chcp 65001 을 하므로 실제 창에서는 제대로 보인다.)
    try:
        sys.stdout.reconfigure(errors="replace", line_buffering=True)
    except Exception:
        pass

    print("=" * 60)
    print("  YouTube 강의 → 슬라이드 PDF")
    print("=" * 60)

    url = args.url
    if not url:
        try:
            url = input("\n  YouTube 주소를 붙여넣고 Enter: ").strip()
        except (EOFError, KeyboardInterrupt):
            return 1
    url = url.strip().strip('"').strip("'")
    if not url:
        print("\n  주소가 없습니다.")
        return 1

    import youtube_to_pdf as y2p

    if y2p._ytdlp_bin() is None:
        print("\n  [필요] yt-dlp 가 없습니다.  pip install -U yt-dlp")
        return 1
    if not y2p._js_runtime(y2p._ytdlp_bin()):
        print("\n  [필요] JavaScript 런타임이 없어 YouTube 가 403 을 냅니다.")
        print("         https://nodejs.org 에서 Node 22 이상을 설치하세요.")
        return 1

    mode = "light" if args.light else "sharp" if args.sharp else "normal"
    max_width, quality, max_mb = PRESETS[mode]
    print(f"\n  화질: {mode}   (가볍게=--light, 선명하게=--sharp)\n")

    workdir = tempfile.mkdtemp(prefix="yt2pdf_")
    output = os.path.join(desktop_dir(), "slides.pdf")
    info: dict = {}
    try:
        slides = y2p.generate(
            url, output, workdir,
            max_width=max_width, quality=quality, max_mb=max_mb,
            start=args.start, end=args.end or None, info=info,
            progress=y2p._console_progress,
        )
    except (RuntimeError, KeyboardInterrupt) as exc:
        print(f"\n  [오류] {exc}")
        return 1
    finally:
        import shutil
        shutil.rmtree(workdir, ignore_errors=True)

    # 영상 제목으로 이름을 바꾼다(같은 이름이 있으면 번호를 붙인다).
    title = safe_name(info.get("title") or "")
    if title:
        target = os.path.join(desktop_dir(), f"{title}.pdf")
        number = 2
        while os.path.exists(target):
            target = os.path.join(desktop_dir(), f"{title} ({number}).pdf")
            number += 1
        try:
            os.replace(output, target)
            output = target
        except OSError:
            pass

    print(f"\n  ✅ 완료!  슬라이드 {len(slides)}장")
    print(f"     {output}")
    open_folder(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
