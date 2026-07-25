# 저장소 루트용 Dockerfile — Render 등에서 Root Directory 설정 없이도
# youtube-slides-pdf 웹 서버가 빌드되도록 한다.
# (Root Directory 를 youtube-slides-pdf 로 지정한 경우엔 그 폴더의 Dockerfile 이 사용됨)
FROM python:3.11-slim

# ffmpeg  : yt-dlp 의 구간 다운로드(--download-sections)에 필요
# libglib : opencv 런타임 의존성
# nodejs  : yt-dlp 가 YouTube 서명을 풀 때 쓰는 JavaScript 런타임.
#           없으면 포맷을 못 얻거나 다운로드가 HTTP 403 으로 실패한다.
#           ※ youtube-slides-pdf/Dockerfile 과 반드시 같이 고칠 것.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libglib2.0-0 nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version

WORKDIR /app

COPY youtube-slides-pdf/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY youtube-slides-pdf/ .

ENV PORT=8000
EXPOSE 8000

# 단일 워커 + 멀티스레드: 작업 상태와 SSE 진행표시를 한 프로세스에서 공유
CMD gunicorn -w 1 --threads 8 --timeout 120 server:app -b 0.0.0.0:$PORT
