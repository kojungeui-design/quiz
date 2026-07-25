# YouTube → 슬라이드 PDF 웹 서버용 이미지
FROM python:3.11-slim

# ffmpeg  : yt-dlp 의 구간 다운로드(--download-sections)에 필요
# libglib : opencv 런타임 의존성
# nodejs  : yt-dlp 가 YouTube 서명을 풀 때 쓰는 JavaScript 런타임.
#           없으면 포맷을 못 얻거나 다운로드가 HTTP 403 으로 실패한다.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libglib2.0-0 nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8000
EXPOSE 8000

# 단일 워커 + 멀티스레드: 진행상황(SSE)과 작업 상태를 한 프로세스에서 공유해야 하므로
# 워커는 반드시 1개로 둔다.  작업 자체는 백그라운드 스레드에서 처리된다.
CMD gunicorn -w 1 --threads 8 --timeout 120 server:app -b 0.0.0.0:$PORT
