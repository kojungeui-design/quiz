# 클라우드 배포 가이드 — "PC 없이, 인터넷 주소로 아무 데서나"

이 문서를 따라 하면 `server.py` 를 **무료 클라우드에 올려서**, PC를 켜두지 않아도
어디서나 접속되는 **인터넷 주소(예: `https://내앱.onrender.com`)** 를 갖게 됩니다.
휴대폰에서 그 주소에 접속해 YouTube 링크만 붙여넣으면 됩니다.

---

## ⚠️ 먼저 꼭 알아둘 점 (중요)

YouTube 는 **클라우드 서버의 IP 를 자주 차단**합니다. 그러면 다운로드가
`"Sign in to confirm you're not a bot"` 오류로 실패합니다. 이건 이 프로그램의
문제가 아니라 YouTube 의 정책이에요.

해결책은 **쿠키 파일을 넣어주는 것**입니다 (아래 3단계에서 설명). 쿠키를 넣으면
서버가 "로그인한 사용자"처럼 동작해 차단을 우회합니다. **개인용으로만 쓰고,
쿠키 파일을 공개하지 마세요.**

---

## 1단계 · Render 에 배포하기 (무료)

[Render](https://render.com) 는 무료 등급이 있고 GitHub 저장소와 바로 연결됩니다.

1. https://render.com 에 GitHub 계정으로 가입/로그인.
2. 오른쪽 위 **New +** → **Web Service**.
3. 이 저장소(`quiz`)를 선택하고 **Connect**.
   - 브랜치는 이 기능이 있는 브랜치를 고르세요.
4. 설정 화면에서 아래처럼 입력합니다.
   | 항목 | 값 |
   |------|-----|
   | **Root Directory** | `youtube-slides-pdf` |
   | **Runtime / Language** | `Docker` (자동 감지됨) |
   | **Instance Type** | `Free` |
5. **Create Web Service** 클릭 → 몇 분 기다리면 빌드가 끝나고
   `https://<이름>.onrender.com` 주소가 생깁니다.
6. 그 주소를 휴대폰 브라우저에서 열면 끝! 🎉

> 저장소 루트에 `render.yaml` 이 있으므로, **New +** → **Blueprint** 로 만들면
> 위 설정이 자동으로 채워집니다.

---

## 2단계 · 잘 되는지 확인

- 만들어진 주소에 접속 → YouTube 강의 링크 붙여넣기 → **슬라이드 추출 시작**.
- 잘 되면 그대로 쓰면 됩니다.
- `"Sign in to confirm you're not a bot"` 같은 오류가 나면 → **3단계(쿠키)** 로.

---

## 3단계 · YouTube 차단 우회용 쿠키 넣기 (필요할 때만)

**(1) 쿠키 파일 만들기 — 내 PC 브라우저에서**
1. Chrome/Edge 에 **"Get cookies.txt LOCALLY"** 확장 프로그램을 설치합니다.
2. 로그인된 상태로 `youtube.com` 에 접속.
3. 확장 프로그램을 눌러 **`cookies.txt`** 파일을 내려받습니다.

**(2) Render 에 쿠키 파일 올리기**
1. Render 대시보드 → 만든 서비스 → 왼쪽 **Environment** 메뉴.
2. **Secret Files** 섹션 → **Add Secret File**.
   - **Filename**: `cookies.txt`
   - **Contents**: 방금 받은 `cookies.txt` 내용을 그대로 붙여넣기.
3. 같은 화면의 **Environment Variables** 에 추가:
   - **Key**: `YTDLP_COOKIES`
   - **Value**: `/etc/secrets/cookies.txt`  ← Render 는 Secret File 을 이 경로에 둡니다.
4. **Save Changes** → 자동으로 다시 배포됩니다.

이제 서버가 쿠키를 사용해 다운로드하므로 차단이 풀립니다.

> 쿠키는 만료될 수 있어요. 한동안 뒤 다시 막히면 (1)~(2) 를 반복해 갱신하세요.

---

## 무료 등급의 한계 (알아두면 좋아요)

- **첫 접속이 느림**: 무료 서버는 안 쓰면 잠들어서, 오랜만에 접속하면 깨어나는 데
  30초~1분쯤 걸립니다. (조금 기다리면 됩니다.)
- **메모리 제한(512MB)**: 아주 긴(1시간+) 고화질 강의는 메모리가 부족할 수 있어요.
  이럴 땐 **고급 옵션에서 시작/끝 구간을 나눠** 처리하세요.
- **처리 시간**: 영상 다운로드 + 분석이라 몇 분 걸릴 수 있습니다(진행바로 표시됨).

---

## 다른 호스팅도 되나요?

`Dockerfile` 이 있으므로 Docker 를 지원하는 곳이면 어디든 됩니다:
- **Railway**, **Fly.io**, **Hugging Face Spaces(Docker)** 등.
- 어느 곳이든 위와 같은 **YouTube IP 차단 → 쿠키(`YTDLP_COOKIES`)** 원리는 동일합니다.

---

## 로컬에서 컨테이너로 먼저 시험해 보기 (선택, PC에 Docker 필요)

```bash
cd youtube-slides-pdf
docker build -t yt2pdf .
docker run --rm -p 8000:8000 yt2pdf
# 브라우저에서 http://localhost:8000
```
