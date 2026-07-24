# youtube_to_pdf — YouTube 강의 → 슬라이드 PDF 자동 변환

YouTube 강의 영상 URL을 붙여넣으면, 영상의 **화면 변화(슬라이드 전환)를 자동으로 감지**해서
바뀐 화면만 캡처하고, 이를 한 장씩 모아 **PDF**로 만들어 주는 명령줄 자동화 도구입니다.

- 🎞️ `yt-dlp` 로 영상을 자동 다운로드
- 🔍 축소 컬러 썸네일의 평균 절대차(MAD) 기반으로 **슬라이드가 바뀌고 화면이 안정된 순간만** 캡처
  - 전환 애니메이션 중간 프레임, 발표자/webcam 오버레이의 미세한 움직임, 중복 슬라이드를 걸러냅니다.
- 🕒 각 캡처에 **타임스탬프**를 새겨 넣음 (원본 영상 위치 추적 용이)
- 📄 캡처 이미지를 손실 없이 하나의 **PDF**로 병합

## 설치

```bash
cd youtube-slides-pdf
pip install -r requirements.txt
```

> 참고: 대부분의 YouTube 영상은 `ffmpeg` 없이도 받아지지만, 고화질 병합이 필요한 일부
> 영상을 위해 `ffmpeg` 가 설치돼 있으면 더 안정적입니다.

## 사용법

```bash
# 가장 기본 — URL만 주면 slides.pdf 생성
python youtube_to_pdf.py "https://www.youtube.com/watch?v=XXXXXXXX"

# 출력 파일명 지정 + 더 촘촘하게 샘플링(0.5초 간격) + 더 민감하게(threshold 낮춤)
python youtube_to_pdf.py "URL" -o lecture.pdf --interval 0.5 --threshold 6

# 특정 구간(초)만 변환
python youtube_to_pdf.py "URL" --start 60 --end 600

# 이미 받아둔 로컬 영상 파일로 변환 (다운로드 생략)
python youtube_to_pdf.py --video lecture.mp4 -o lecture.pdf

# URL 없이 실행하면 대화형으로 URL을 물어봅니다
python youtube_to_pdf.py
```

## 주요 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `url` | — | YouTube 영상 URL (생략 시 입력 요청) |
| `-o, --output` | `slides.pdf` | 출력 PDF 경로 |
| `--interval` | `1.0` | 프레임 샘플링 간격(초). 작을수록 촘촘하지만 느림 |
| `--threshold` | `8.0` | 슬라이드 변경으로 볼 최소 차이(0~100). **낮추면 더 민감** |
| `--settle` | `2.0` | 화면 '안정' 판정 최대 차이(0~100). 전환 애니메이션 무시용 |
| `--start` / `--end` | 전체 | 변환할 구간(초) |
| `--max-height` | `720` | 다운로드 최대 화질(px) |
| `--no-timestamp` | off | 타임스탬프를 넣지 않음 |
| `--keep-images DIR` | — | 캡처한 원본 이미지를 해당 폴더에 함께 보관 |
| `--video PATH` | — | 다운로드 대신 로컬 영상 파일 사용 |

## 동작 원리

1. **다운로드** — `yt-dlp` 로 (병합이 필요 없는 progressive mp4 우선) 영상을 임시 폴더에 저장.
2. **화면 변화 감지** — `--interval` 초 간격으로 프레임을 뽑아 각 프레임을 32×32 블러 컬러
   썸네일(‘지문’)로 축약합니다. 두 조건을 동시에 만족할 때만 새 슬라이드로 캡처합니다.
   - *안정*: 직전 샘플과의 차이가 `--settle` 이하 → 전환 중이 아님
   - *변경*: 마지막으로 캡처한 슬라이드와의 차이가 `--threshold` 이상 → 실제로 내용이 바뀜
3. **PDF 생성** — 캡처 이미지를 `img2pdf` 로 손실 없이 한 페이지씩 병합.

## 결과가 이상할 때

- **슬라이드를 놓친다** → `--threshold` 를 낮추고(예: 5), `--interval` 을 줄이세요(예: 0.5).
- **같은 슬라이드가 여러 장 잡힌다** → `--threshold` 를 높이세요(예: 12), `--settle` 을 약간
  올리세요(예: 3).
- **다운로드가 실패한다** → `yt-dlp` 를 최신으로 업데이트(`pip install -U yt-dlp`)하거나
  `ffmpeg` 설치를 확인하세요.
