# YouTube → 슬라이드 PDF 웹 서버용 이미지
FROM python:3.11-slim

# yt-dlp 용 ffmpeg, opencv 용 libglib
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8000
EXPOSE 8000

# 단일 워커 + 멀티스레드: 진행상황(SSE)과 작업 상태를 한 프로세스에서 공유해야 하므로
# 워커는 반드시 1개로 둔다.  작업 자체는 백그라운드 스레드에서 처리된다.
CMD gunicorn -w 1 --threads 8 --timeout 120 server:app -b 0.0.0.0:$PORT
