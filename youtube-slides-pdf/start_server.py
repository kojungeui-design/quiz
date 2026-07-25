#!/usr/bin/env python3
"""휴대폰에서 쓰기 위한 실행 도우미.

server.py 를 띄우고, 휴대폰으로 접속할 주소를 QR 코드까지 함께 보여 준다.
필요하면 Cloudflare 터널을 열어 집 밖에서도 접속할 수 있게 한다.

    python start_server.py              # 같은 WiFi 에서 접속
    python start_server.py --tunnel     # 집 밖에서도 접속 (cloudflared 필요)

윈도우에서는 이 폴더의 `휴대폰으로 쓰기.bat` 을 더블클릭하면 된다.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------
# QR 코드 — 의존성 없이 터미널에 그린다
# ---------------------------------------------------------------------------
def print_qr(text: str) -> bool:
    """qrcode 패키지가 있으면 터미널에 QR 을 그리고 True. 없으면 False."""
    try:
        import qrcode  # type: ignore
    except ImportError:
        return False

    qr = qrcode.QRCode(border=1)
    qr.add_data(text)
    qr.make(fit=True)
    matrix = qr.get_matrix()

    # 위아래 두 줄을 반칸 블록 하나로 합쳐 세로를 절반으로 줄인다(터미널에 맞게).
    print()
    for y in range(0, len(matrix), 2):
        row = ""
        for x in range(len(matrix[0])):
            top = matrix[y][x]
            bottom = matrix[y + 1][x] if y + 1 < len(matrix) else False
            row += "█" if top and bottom else "▀" if top else "▄" if bottom else " "
        print("  " + row)
    print()
    return True


def lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ---------------------------------------------------------------------------
def check_requirements() -> bool:
    """필요한 것들이 갖춰졌는지 확인하고, 없으면 무엇을 해야 하는지 알려 준다."""
    ok = True

    try:
        import cv2, img2pdf, numpy, PIL, flask  # noqa: F401
    except ImportError as exc:
        print(f"  [필요] 파이썬 패키지가 없습니다 ({exc.name}).")
        print("         이 폴더에서: pip install -r requirements.txt")
        ok = False

    sys.path.insert(0, HERE)
    try:
        import youtube_to_pdf as y2p
        ytdlp = y2p._ytdlp_bin()
    except Exception:
        ytdlp = None
    if not ytdlp:
        print("  [필요] yt-dlp 가 없습니다.  pip install -U yt-dlp")
        ok = False

    # yt-dlp 는 YouTube 서명을 풀 때 JS 런타임을 쓴다. 없으면 403 으로 실패한다.
    if not any(shutil.which(n) for n in ("deno", "node", "bun")):
        print("  [필요] JavaScript 런타임이 없습니다 (403 오류의 원인).")
        print("         https://nodejs.org 에서 Node 22 이상을 설치하세요.")
        ok = False

    if shutil.which("ffmpeg") is None:
        print("  [선택] ffmpeg 이 없습니다. 구간만 받는 기능이 꺼집니다(전체를 받습니다).")

    return ok


def find_cloudflared() -> "str | None":
    """cloudflared 실행 파일을 찾는다.

    갓 설치한 직후에는 PATH 갱신이 지금 열려 있는 창에 반영되지 않는다.
    (다시 로그인해야 보인다.)  그래서 흔한 설치 위치도 함께 뒤진다.
    """
    found = shutil.which("cloudflared")
    if found:
        return found

    candidates = [
        os.path.join(os.environ.get("ProgramFiles", ""), "cloudflared", "cloudflared.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), "cloudflared", "cloudflared.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""),
                     "Microsoft", "WinGet", "Links", "cloudflared.exe"),
        "/usr/local/bin/cloudflared",
        "/opt/homebrew/bin/cloudflared",
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


def start_tunnel(port: int, out) -> "subprocess.Popen | None":
    """cloudflared 로 임시 공개 주소를 연다. 계정 없이 바로 된다."""
    binary = find_cloudflared()
    if binary is None:
        print("  [안내] cloudflared 가 없어 집 밖 접속은 건너뜁니다.")
        print("         설치: winget install Cloudflare.cloudflared")
        return None

    proc = subprocess.Popen(
        [binary, "tunnel", "--url", f"http://127.0.0.1:{port}"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1, encoding="utf-8", errors="replace",
    )

    def watch():
        pattern = re.compile(r"https://[-\w.]+\.trycloudflare\.com")
        for line in proc.stdout:  # type: ignore[union-attr]
            match = pattern.search(line)
            if match:
                out.append(match.group(0))
                return

    threading.Thread(target=watch, daemon=True).start()
    return proc


def main() -> int:
    ap = argparse.ArgumentParser(description="휴대폰에서 쓰는 슬라이드 PDF 서버")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--tunnel", action="store_true",
                    help="집 밖에서도 접속할 수 있는 공개 주소를 만든다")
    args = ap.parse_args()

    # 출력이 파이프로 넘어갈 때도 안내가 바로 보이도록(버퍼에 갇히지 않게).
    # errors="replace" 는 cp949 콘솔에서 QR 블록·기호 때문에 죽지 않게 하려는 것.
    try:
        sys.stdout.reconfigure(errors="replace", line_buffering=True)
    except Exception:
        pass

    print("=" * 60)
    print("  YouTube → 슬라이드 PDF — 휴대폰용 서버")
    print("=" * 60)
    if not check_requirements():
        print("\n위 항목을 먼저 해결한 뒤 다시 실행하세요.")
        return 1

    server = subprocess.Popen(
        [sys.executable, os.path.join(HERE, "server.py"), "--port", str(args.port)],
        cwd=HERE,
    )

    public: list = []
    tunnel = start_tunnel(args.port, public) if args.tunnel else None

    # 서버가 뜰 때까지 잠깐 기다린다.
    address = f"http://{lan_ip()}:{args.port}"
    for _ in range(40):
        time.sleep(0.5)
        if public:
            break
        if server.poll() is not None:
            print("\n서버가 시작하지 못했습니다.")
            return 1
        if not args.tunnel:
            break

    print()
    print("─" * 60)
    print("  휴대폰 브라우저에서 아래 주소로 접속하세요")
    print()
    print(f"   [집 안 · 같은 WiFi]   {address}")
    if public:
        print(f"   [집 밖 · 어디서나]    {public[0]}")
    print()
    if public:
        # 집 안에서 터널 주소를 쓰면 인터넷을 한 바퀴 돌아 훨씬 느리다.
        # 실측: 같은 WiFi 49MB/s vs 터널 0.37MB/s (130배 차이)
        print("  ※ 집에 있을 때는 반드시 위쪽(WiFi) 주소를 쓰세요. 훨씬 빠릅니다.")
        print("     아래 터널 주소는 밖에 있을 때만. 이 창을 닫으면 사라집니다.")
    else:
        print("  ※ 휴대폰이 이 PC와 같은 WiFi 에 있어야 합니다.")
        print("     집 밖에서도 쓰려면:  python start_server.py --tunnel")
    print("─" * 60)

    # QR 은 집에서 주로 쓰는 WiFi 주소로 만든다.
    if not print_qr(address):
        print("  (QR 코드를 보려면:  pip install qrcode)")

    print("  종료하려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으세요.")
    print()

    try:
        server.wait()
    except KeyboardInterrupt:
        print("\n종료합니다…")
    finally:
        for proc in (server, tunnel):
            if proc and proc.poll() is None:
                proc.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
