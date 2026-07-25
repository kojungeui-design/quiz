# 저장소 루트용 Dockerfile — Render 등에서 Root Directory 설정 없이도
# youtube-slides-pdf 웹 서버가 빌드되도록 한다.
# (Root Directory 를 youtube-slides-pdf 로 지정한 경우엔 그 폴더의 Dockerfile 이 사용됨)
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY youtube-slides-pdf/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY youtube-slides-pdf/ .

ENV PORT=8000
EXPOSE 8000

# 단일 워커 + 멀티스레드: 작업 상태와 SSE 진행표시를 한 프로세스에서 공유
CMD gunicorn -w 1 --threads 8 --timeout 120 server:app -b 0.0.0.0:$PORT
