# 이 폴더에 대하여

이 저장소에서 쓰는 Claude 스킬(Agent Skills)을 모아둔 곳입니다.

저장소에 함께 커밋되어 있어서, **어느 기기에서 접속하든(회사 PC·노트북·집 노트북·폰·태블릿)
별도 설치 없이 자동으로 적용**됩니다. 로컬 CLI에서도 `git pull` 하면 그대로 따라옵니다.

## 설치된 스킬

### baoyu-design

claude.ai/design(Claude Design)을 로컬 에이전트 스킬로 옮긴 것. UI 목업, 인터랙티브
프로토타입, 와이어프레임, 랜딩페이지, 대시보드, 슬라이드 덱, 문서, 애니메이션 등을
자체 완결형 HTML로 만들어 줍니다. 덱은 PowerPoint(.pptx)로 내보낼 수 있습니다.

- 출처: https://github.com/JimLiu/baoyu-design
- 버전: v1.2.0 (`026d4ea`, 2026-07-29)
- 라이선스: MIT (Copyright (c) 2026 Jim Liu 宝玉) — `baoyu-design/LICENSE` 참고

**쓰는 법:** 그냥 평소처럼 말하면 됩니다. "이 페이지 디자인해줘", "제안서 슬라이드 만들어줘"
같은 요청에 Claude가 알아서 이 스킬을 불러 씁니다.

**업데이트하려면:** 자동으로 갱신되지 않습니다. 최신판이 필요하면 Claude에게
"baoyu-design 스킬 최신 버전으로 업데이트해줘"라고 요청하세요.
