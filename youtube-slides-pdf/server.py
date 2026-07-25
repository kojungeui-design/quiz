#!/usr/bin/env python3
"""
server.py — "휴대폰에서 YouTube 주소만 붙여넣으면 PDF" 를 가능하게 하는 웹 서버.

브라우저는 보안 때문에 YouTube 화면을 직접 캡처할 수 없지만, 서버는 할 수 있다.
이 서버를 PC(또는 서버 호스트)에서 실행해 두면, 같은 네트워크의 휴대폰 브라우저로
접속해 주소만 넣어도 슬라이드 PDF를 받을 수 있다.

실행:
    pip install -r requirements.txt
    python server.py                 # 기본 http://0.0.0.0:8000
    python server.py --port 5000

사용:
    1) PC에서 위 명령 실행 → 터미널에 접속 주소가 표시된다.
    2) 휴대폰 브라우저로 그 주소(예: http://192.168.0.10:8000) 접속.
    3) YouTube 주소를 붙여넣고 [슬라이드 추출 시작] → 끝나면 [PDF 다운로드].

주의: yt-dlp 가 설치돼 있어야 하고(요구사항에 포함), 서버가 있는 네트워크에서
YouTube 에 접근 가능해야 한다.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import shutil
import socket
import tempfile
import threading
import time
import uuid

from flask import Flask, Response, jsonify, request, send_file

import youtube_to_pdf as y2p

HERE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__)
print(f"[server] youtube-slides-pdf 부팅 완료 (PORT={os.environ.get('PORT', '8000')})",
      flush=True)

# job_id -> job dict
JOBS: dict = {}
JOBS_LOCK = threading.Lock()
JOB_TTL = 30 * 60  # 완료 후 30분 뒤 정리


# ---------------------------------------------------------------------------
def sensitivity_to_thresholds(sensitivity: float):
    """UI 민감도(3~20)를 감지 임계값으로 변환."""
    change = float(sensitivity)
    settle = max(1.5, change * 0.35)
    return change, settle


# UI 의 'PDF 용량' 선택지 → (가로폭 px, JPEG 화질, 목표 용량 MB)
# 강의 슬라이드는 글자만 읽히면 되므로 기본값도 꽤 과감하게 줄여 둔다.
SIZE_MODES = {
    "light":  (1100, 62, 5.0),
    "normal": (1600, 80, 15.0),
    "sharp":  (1920, 90, None),
}


def size_mode_settings(mode: str):
    return SIZE_MODES.get(mode, SIZE_MODES["normal"])


# 파일명에 쓸 수 없는 글자들(윈도우 기준이 가장 빡빡하다)
_BAD_FILENAME_CHARS = '\\/:*?"<>|\r\n\t'


def pdf_filename(job: dict) -> str:
    """영상 제목으로 PDF 파일명을 만든다. 제목이 없으면 기본값."""
    title = (job.get("title") or "").strip()
    for ch in _BAD_FILENAME_CHARS:
        title = title.replace(ch, " ")
    title = " ".join(title.split())[:80].strip(" .")
    return f"{title}.pdf" if title else "slides.pdf"


def run_job(job_id: str, params: dict) -> None:
    job = JOBS[job_id]
    q: queue.Queue = job["queue"]
    workdir = job["workdir"]
    out_pdf = os.path.join(workdir, "slides.pdf")

    def log(msg):
        q.put(("log", msg))

    def progress(frac, text, count):
        q.put(("progress", json.dumps({"frac": frac, "text": text, "count": count})))

    try:
        change, settle = sensitivity_to_thresholds(params["sensitivity"])
        max_width, quality, max_mb = size_mode_settings(params["size_mode"])
        info: dict = {}
        slides = y2p.generate(
            params["url"],
            out_pdf,
            workdir,
            is_local=False,
            interval=params["interval"],
            change_threshold=change,
            settle_threshold=settle,
            start=params["start"],
            end=params["end"] or None,
            add_timestamp=params["timestamp"],
            max_width=max_width,
            quality=quality,
            max_mb=max_mb,
            info=info,
            log=log,
            progress=progress,
        )
        job["title"] = info.get("title")
        job["pdf"] = out_pdf
        job["count"] = len(slides)
        job["done_at"] = time.time()
        size_mb = round(os.path.getsize(out_pdf) / (1024 * 1024), 1)
        q.put(("done", json.dumps({"count": len(slides), "mb": size_mb})))
    except Exception as e:  # noqa: BLE001  사용자에게 원인 전달
        job["error"] = str(e)
        q.put(("error", str(e)))
    finally:
        q.put(("__end__", ""))


def cleanup_old_jobs() -> None:
    now = time.time()
    with JOBS_LOCK:
        stale = [
            jid for jid, j in JOBS.items()
            if j.get("done_at") and now - j["done_at"] > JOB_TTL
        ]
        for jid in stale:
            shutil.rmtree(JOBS[jid]["workdir"], ignore_errors=True)
            JOBS.pop(jid, None)


# ---------------------------------------------------------------------------
@app.get("/")
def index():
    return send_file(os.path.join(HERE, "webapp.html"))


@app.post("/api/jobs")
def create_job():
    cleanup_old_jobs()
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "URL 이 필요합니다."}), 400

    params = {
        "url": url,
        "sensitivity": float(data.get("sensitivity", 8)),
        "interval": max(0.1, float(data.get("interval", 1.0))),
        "timestamp": bool(data.get("timestamp", True)),
        "start": max(0.0, float(data.get("start", 0) or 0)),
        "end": float(data.get("end", 0) or 0),
        "size_mode": str(data.get("size_mode") or "normal"),
    }

    job_id = uuid.uuid4().hex[:12]
    job = {
        "queue": queue.Queue(),
        "workdir": tempfile.mkdtemp(prefix="yt2pdf_srv_"),
        "pdf": None,
        "error": None,
        "count": 0,
        "done_at": None,
    }
    with JOBS_LOCK:
        JOBS[job_id] = job
    threading.Thread(target=run_job, args=(job_id, params), daemon=True).start()
    return jsonify({"id": job_id})


@app.get("/api/jobs/<job_id>/stream")
def stream(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "작업을 찾을 수 없습니다."}), 404

    def gen():
        q: queue.Queue = job["queue"]
        # 연결 유지용 초기 코멘트
        yield ": connected\n\n"
        while True:
            try:
                ev, data = q.get(timeout=15)
            except queue.Empty:
                yield ": ping\n\n"  # keep-alive
                continue
            if ev == "__end__":
                break
            # SSE 는 줄바꿈을 특별 취급 → 안전하게 인코딩
            payload = str(data).replace("\r", "").split("\n")
            out = f"event: {ev}\n"
            for line in payload:
                out += f"data: {line}\n"
            out += "\n"
            yield out

    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/jobs/<job_id>/pdf")
def download_pdf(job_id: str):
    job = JOBS.get(job_id)
    if not job or not job.get("pdf") or not os.path.exists(job["pdf"]):
        return jsonify({"error": "PDF 가 아직 준비되지 않았습니다."}), 404
    return send_file(job["pdf"], mimetype="application/pdf",
                     as_attachment=True, download_name=pdf_filename(job))


# ---------------------------------------------------------------------------
def lan_ip() -> str:
    """휴대폰에서 접속할 때 쓸 LAN IP 추정."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    ap = argparse.ArgumentParser(description="YouTube→슬라이드 PDF 웹 서버")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    args = ap.parse_args()

    ip = lan_ip()
    print("=" * 56)
    print("  YouTube → 슬라이드 PDF 서버 실행 중")
    print(f"  이 PC에서       : http://127.0.0.1:{args.port}")
    print(f"  같은 WiFi 휴대폰: http://{ip}:{args.port}")
    print("=" * 56)
    # PATH 에 없어도 `python -m yt_dlp` 로 돌 수 있으므로 which 대신 이쪽으로 확인한다.
    if y2p._ytdlp_bin() is None:
        print("  [주의] yt-dlp 가 없습니다.  pip install -r requirements.txt")

    # Flask 내장 서버는 개발용이라 동시 접속(진행 스트림 + PDF 내려받기)에 약하다.
    # waitress 가 있으면 그쪽을 쓴다(윈도우에서도 도는 실제 WSGI 서버).
    try:
        from waitress import serve
    except ImportError:
        print("  [참고] waitress 를 설치하면 더 빠릅니다:  pip install waitress")
        app.run(host=args.host, port=args.port, threaded=True)
    else:
        # SSE 를 계속 열어 두므로 스레드를 넉넉히, 응답 버퍼는 크게 잡는다.
        serve(app, host=args.host, port=args.port, threads=16,
              outbuf_overflow=64 * 1024 * 1024, channel_timeout=1800)


if __name__ == "__main__":
    main()
