/**
 * bdprs-tools/build-guide.mjs — Battery Design Studio 사용가이드 HTML 생성.
 *
 *   node build-guide.mjs <스크린샷폴더> <출력.html>
 *
 * 스크린샷을 data URI 로 심어 파일 하나로 완결시킨다. 사내 공유 시 폴더째 옮길 필요가 없고,
 * 인터넷 없이도 열린다(설계 도구 자체와 같은 원칙).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , shotDir, outFile] = process.argv;
if (!shotDir || !outFile) {
  console.error('사용법: node build-guide.mjs <스크린샷폴더> <출력.html>');
  process.exit(1);
}

const img = (name) => {
  const b64 = readFileSync(resolve(shotDir, name)).toString('base64');
  return `data:image/jpeg;base64,${b64}`;
};

/** 화면 그림 + 설명. caption 은 "이 그림에서 무엇을 보라"는 안내. */
const figure = (file, caption, note) => `
<figure>
  <img src="${img(file)}" alt="${caption}" loading="lazy">
  <figcaption><strong>${caption}</strong>${note ? ` — ${note}` : ''}</figcaption>
</figure>`;

const steps = [
  {
    n: '01',
    title: '과제 만들기',
    lead: '프로그램은 <b>과제</b> 단위로 움직입니다. 고객 RFQ 하나 = 과제 하나라고 생각하면 됩니다.',
    body: `
      <ol>
        <li><code>배터리설계스튜디오.html</code> 파일을 <b>더블클릭</b>합니다. 설치도, 인터넷도 필요 없습니다.</li>
        <li>첫 화면이 <b>개발 워크벤치</b>입니다. 처음에는 과제가 하나도 없습니다.</li>
        <li>오른쪽 위 <b>새 과제</b>를 누릅니다.</li>
      </ol>
      ${figure('01-workbench-empty.jpg', '개발 워크벤치 (처음 열었을 때)', '아래쪽 “데이터 준비도”에서 제품군별 근거등급을 미리 볼 수 있습니다')}
      <div class="tip"><b>왼쪽 메뉴가 순서입니다.</b> 요구사양 → 기존 PCC 매칭 → 설계·BOM → 원가 → 보고서. 위에서 아래로 따라가면 됩니다.</div>`,
  },
  {
    n: '02',
    title: '요구사양 입력하기',
    lead: '고객이 요구한 성능을 그대로 적는 단계입니다. <b>여기가 전부</b>라고 해도 됩니다 — 뒤 단계는 자동입니다.',
    body: `
      ${figure('02-requirements.jpg', '새 과제를 만들면 바로 열리는 요구사양 화면')}
      <h4>① 과제 정보</h4>
      <p>과제명·고객·RFQ 번호·담당자를 적습니다. 보고서에 그대로 찍히므로 정확히 적어주세요.</p>
      <p><b>비교 관점</b>은 3개 설계안의 순위를 매기는 기준입니다. 잘 모르겠으면 <b>균형</b>으로 두세요.</p>

      <h4>② 제품군 선택 — 가장 중요한 한 번의 선택</h4>
      <p>제품군을 고르면 <b>그 제품군의 사내 실적 대표값이 목표 초기값으로 자동으로 채워집니다.</b>
         목록에 <code>12M24 · PA · A등급 · 판매 4종</code> 처럼 근거등급이 함께 보입니다.</p>
      <table class="grade">
        <tr><th>등급</th><th>뜻</th><th>써도 되나</th></tr>
        <tr><td><span class="g gA">A</span></td><td>4개 지표가 온전한 실적 3건 이상</td><td>안심하고 사용</td></tr>
        <tr><td><span class="g gB">B</span></td><td>실적 2건 이상</td><td>사용 가능</td></tr>
        <tr><td><span class="g gC">C</span></td><td>실적 1건</td><td>참고용, 검증 필요</td></tr>
        <tr><td><span class="g gD">D</span></td><td>근거 실적 없음</td><td class="bad">승인 근거로 쓸 수 없음</td></tr>
      </table>

      <h4>③ 목표 성능 입력</h4>
      <p>자동으로 채워진 값을 <b>고객 요구값으로 바꿔</b> 넣습니다. 칸 아래 회색 글씨가 DB 대표값이니 비교하며 넣으세요.</p>
      ${figure('03b-requirements-filled.jpg', '목표값을 고객 요구값으로 바꾼 상태', '입력이 정상이면 초록색 “입력 완료” 배지가 뜹니다')}
      <table class="fields">
        <tr><th>칸</th><th>무엇을 넣나</th><th>주의</th></tr>
        <tr><td>C20 용량</td><td>20시간율 용량 (Ah)</td><td>—</td></tr>
        <tr><td>RC</td><td>예비용량 (분)</td><td>—</td></tr>
        <tr><td>EN CCA / SAE CCA</td><td>저온 시동전류 (A)</td><td>규격이 다릅니다. 둘 다 넣으세요</td></tr>
        <tr><td>최대 허용매수</td><td>케이스에 들어갈 수 있는 극판 매수 상한</td><td class="warn">결과 매수를 정하는 값이 아니라 <b>탐색 상한</b>입니다</td></tr>
        <tr><td>셀 수</td><td>12V면 <b>6</b></td><td class="warn">6V·24V 제품은 반드시 바꾸세요. 안 바꾸면 원가가 틀립니다</td></tr>
        <tr><td>연간 기준수량</td><td>사업계획 수량 (대)</td><td>라인업 가중 평균원가의 가중치</td></tr>
      </table>

      <h4>④ 제품 여러 개 넣기 (라인업)</h4>
      <p>오른쪽 위 <b>+ 제품 추가</b>로 제품을 늘립니다. 한 과제에 여러 제품을 넣어야
         <b>공용화</b>(여러 제품이 극판을 함께 쓰는 것)를 검토할 수 있습니다.</p>
      ${figure('04-lineup-2products.jpg', '제품 2개를 넣은 라인업', '카드 오른쪽 위 아이콘으로 복제·삭제할 수 있습니다')}
      <div class="warn-box"><b>빨간 표시가 남아 있으면 다음으로 못 갑니다.</b> 목표값을 비워두면 성능여유를 계산할 수 없기 때문입니다. 노란 “확인 권장”은 경고일 뿐 진행은 됩니다.</div>`,
  },
  {
    n: '03',
    title: '기존 제품으로 되는지 먼저 보기',
    lead: '새로 설계하기 전에 <b>이미 만들고 있는 제품으로 충족되는지</b> 먼저 확인합니다. 되면 개발비가 0입니다.',
    body: `
      <p>요구사양 화면 맨 아래 <b>기존 PCC 매칭으로 이동</b>을 누르면 계산이 돌고 이 화면이 열립니다.</p>
      ${figure('05-matching.jpg', '기존 PCC 매칭 결과')}
      <ul>
        <li><b>직접 적용 가능</b> — 4개 성능을 모두 충족하고 매수 상한 안에 드는 기존 제품. <b>이게 있으면 개발 끝입니다.</b></li>
        <li><b>근접 설계</b> — 성능이 조금 모자라거나 매수를 넘겨, 개조 기준품으로만 쓸 수 있는 제품.</li>
        <li>마음에 드는 제품을 <b>기준품으로 지정</b>하면, 3안에서 그 제품의 등록 BOM·성능·매수를 그대로 적용합니다.</li>
      </ul>
      <div class="warn-box"><b>케이스 도면은 판정하지 않습니다.</b> 성능이 맞아도 외형 치수·단자 위치는 도면으로 따로 확인해야 합니다.</div>`,
  },
  {
    n: '04',
    title: '설계안 3개 비교하기',
    lead: '프로그램이 <b>같은 요구사양으로 3가지 설계</b>를 만들어 나란히 보여줍니다.',
    body: `
      ${figure('06-design.jpg', '설계안 3종 비교', '초록 테두리가 현재 선택안, “현재 관점 우선안” 배지가 프로그램의 추천')}
      <table class="plans">
        <tr><th>안</th><th>내용</th><th>개발 기간</th><th>위험</th></tr>
        <tr><td><b>1안</b> 모두 신형 극판</td><td>양·음극을 새로 설계 (양극 0.7T Punch)</td><td>5.5개월</td><td class="bad">높음</td></tr>
        <tr><td><b>2안</b> 신형 + 기존 공용</td><td>양극만 신형, 음극은 기존 것</td><td>3.5개월</td><td class="warn">보통</td></tr>
        <tr><td><b>3안</b> 기존 극판 공용</td><td>이미 있는 극판만 조합</td><td class="good">1.5개월</td><td class="good">낮음</td></tr>
      </table>
      <div class="tip"><b>금형비는 기본 0입니다.</b> 사내에 극판 금형이 확보되어 있어 신규 극판을 설계해도
        별도 투자가 들지 않기 때문입니다. 그래서 <b>신형(1·2안)이 기존(3안)보다 대당 원가가 오히려 쌀 수 있습니다.</b>
        3안의 강점은 원가가 아니라 <u>개발기간과 낮은 위험</u>입니다. 신규 사이즈 금형처럼 투자가 실제로 드는
        과제라면 요구사양 화면의 <b>원가 가정</b>에 그 금액을 넣으세요.</div>
      <p>카드에서 볼 것은 <b>목표 충족(몇/몇)</b>, <b>가중 평균원가</b>, <b>개발 기간</b>, <b>공용화율</b> 네 가지입니다.
         카드를 누르면 그 안이 선택안이 되고, 아래 BOM 표가 그 안 기준으로 바뀝니다.</p>

      <h4>극판 BOM 표 읽는 법</h4>
      ${figure('07-design-scroll.jpg', '선택안의 극판 BOM')}
      <ul>
        <li><b>매수</b> — 목표를 모두 만족하는 <u>최소</u> 매수를 고릅니다. 아래 <code>+5 / −4</code>는 양극/음극 장수입니다.</li>
        <li><b>성능여유</b> — 초록은 여유 있음, 빨강은 미달. <b>+0%대는 아슬아슬하다는 뜻</b>이니 시제품 검증 1순위로 두세요.</li>
        <li><b>근거</b> — A~D 등급과 신뢰지수. D등급은 승인 근거로 쓸 수 없습니다.</li>
        <li><b>봉합</b> — 격리판 봉합 극성. 입력하는 값이 아니라 극판 조합에서 자동으로 나옵니다(아래 D 항목 참고).</li>
        <li><b>납중량</b> — 기판납 + 활물질납 + COS납. <code>*</code> 표시는 모델 추정값(실측 735건 기준 평균오차 3.9%)입니다.</li>
      </ul>
      <div class="tip">오른쪽 위 <b>설계 BOM Excel</b> 로 이 표를 그대로 엑셀로 받을 수 있습니다.</div>

      <h4>슬라이더로 즉석에서 바꿔보기 (실시간 설계 조절)</h4>
      <p>BOM 표 아래에 <b>실시간 설계 조절</b> 카드가 있습니다. 여기서는 요구사양을 다시 입력하지 않고도
         <b>기판두께·활물질·매수를 그 자리에서 움직여</b> 성능과 납중량이 어떻게 따라오는지 볼 수 있습니다.
         “활물질을 5g 더 넣으면 납이 얼마나 늘지?” 같은 질문에 몇 초면 답이 나옵니다.</p>
      ${figure('07b-whatif-base.jpg', '조절 전 — 슬라이더는 확정 설계값에 맞춰져 있고, 변화는 모두 “동일”', '기준값으로 되돌리기 버튼은 언제든 이 상태로 되돌립니다')}
      ${figure('07c-whatif-tuned.jpg', '활물질을 올리고 매수를 2매 늘린 뒤', '변화 열에 증감이, 납중량 아래에 기판·활물질·COS 내역이 함께 바뀝니다')}
      <ul>
        <li><b>양극·음극 기판두께</b> (0.50~1.30T) — 기판납과 CCA가 따라 움직입니다.</li>
        <li><b>양극 활물질</b> (실적범위 ±30%) — C20·RC와 활물질납이 따라 움직입니다.</li>
        <li><b>조립매수</b> — 전 항목이 함께 움직이고, 양극/음극 배분도 다시 잡힙니다.</li>
        <li><b>납중량 줄</b>에 <code>기판 1.08 · 활물질 2.24 · COS 0.27</code> 처럼 내역이 붙습니다.
            늘어난 납이 어디서 왔는지 바로 보이니, 줄일 곳을 찾을 때 여기부터 보세요.</li>
      </ul>
      <h4>라인업 전체 숫자도 같이 움직입니다</h4>
      <p>제품이 여러 개면 카드 오른쪽 위에서 <b>제품을 골라</b> 각각 조절할 수 있고, 만져둔 값은 제품마다 그대로 남습니다.
         제품을 오가며 비교해도 날아가지 않습니다.</p>
      ${figure('07d-whatif-lineup.jpg', '라인업 전체 표', '제품 하나만 조절해도 가중 평균원가·연간 납 소요량이 함께 움직입니다')}
      <ul>
        <li><b>가중 평균원가</b> — 연간 물량으로 가중합니다. <b>물량 큰 제품을 만질수록 크게 움직입니다.</b></li>
        <li><b>목표 충족 제품</b> — 조절 때문에 목표를 놓치는 제품이 생기면 여기서 바로 줄어듭니다.</li>
        <li><b>연간 납 소요량(톤)</b> — 대당 납중량 × 연간 물량. 라인업 전체 납 구매량이 몇 톤 늘고 주는지 보입니다.</li>
        <li><b>공용 극판군 · 개발 투자</b> — 금형비를 0이 아닌 값으로 넣은 과제에서만 움직입니다(기본값은 0).</li>
      </ul>
      <div class="tip"><b>라인업 개발에서 제일 쓸모 있는 사용법</b> — 물량이 가장 큰 제품부터 활물질을 조금씩 줄여보세요.
        성능여유가 아직 초록인데 라인업 납 소요량과 평균원가가 눈에 띄게 내려간다면, 그게 바로 과설계입니다.</div>

      <div class="warn-box"><b>여기서 바꾼 값은 저장되지 않습니다.</b> 화면을 벗어나면 사라지는 검토용 탐색입니다.
        확정하려면 <b>요구사양으로 돌아가 값을 바꾸고 정식으로 다시 계산</b>해야 보고서·BOM·원가에 반영됩니다.
        일부러 이렇게 만들었습니다 — 슬라이더로 만진 값이 결재 문서에 그대로 실리면 안 되기 때문입니다.</div>
      <div class="tip">실적 범위를 벗어나면 <b>막지 않고 노란 경고</b>가 뜹니다. 탐색은 자유롭게 하되,
        경고가 뜬 값은 “근거 없는 추정”이라는 뜻이니 그대로 제안하지 마세요.
        기판두께는 근사 모델(CCA 두께계수 −14%~+4%)이라 <b>반드시 시제품으로 확인</b>해야 합니다.</div>`,
  },
  {
    n: '05',
    title: '원가와 수익성 보기',
    lead: '판매단가를 넣으면 대당 공헌이익과 투자 회수 시점을 계산합니다.',
    body: `
      ${figure('08-costing.jpg', '원가·수익성 화면')}
      <div class="warn-box"><b>여기 원가는 견적가가 아닙니다.</b> 극판 재료비와 조립비 중심의 <u>설계 비교값</u>입니다.
        실제 견적에는 케이스·분리판·전해액·물류·환율·보증조건이 더 들어가야 합니다.</div>`,
  },
  {
    n: '06',
    title: '보고서 뽑기',
    lead: '요구사양부터 3개안 비교까지 <b>같은 버전으로</b> 한 장에 출력합니다.',
    body: `
      ${figure('09-report.jpg', '분석보고서')}
      ${figure('10-report-bom.jpg', '보고서의 설계 BOM과 근거·한계')}
      <ul>
        <li><b>인쇄 / PDF 저장</b> — 사이드바·버튼이 빠지고 문서만 남게 인쇄됩니다.</li>
        <li>엔진 버전과 DB 버전이 함께 찍힙니다. <b>나중에 “그때 어떤 데이터로 뽑았나”를 추적할 수 있습니다.</b></li>
        <li>맨 아래 <b>근거와 한계</b>는 지우지 마세요. 예측 보정 적용 여부까지 자동으로 적힙니다.</li>
      </ul>
      <div class="warn-box">내보낸 파일에는 <b>극판 코드와 원가</b>가 들어갑니다. 사외 공유 전에 반드시 확인하세요.</div>`,
  },
];

const advanced = [
  {
    n: 'A',
    title: '사내 DB 갱신하기',
    lead: '실적이 갱신되면 <b>프로그램 안에서 직접</b> CSV로 올릴 수 있습니다. 개발자에게 요청할 필요가 없습니다.',
    body: `
      <p>왼쪽 메뉴 <b>제품·극판 DB</b> → <b>사내 DB 갱신</b> 카드.</p>
      ${figure('11-database.jpg', '제품·극판 DB 화면')}
      ${figure('12-db-import.jpg', '사내 DB 갱신 카드')}
      <ol>
        <li><b>제품 양식</b> / <b>극판 양식</b> 을 눌러 CSV 서식을 받습니다. (지금 DB를 그대로 받아 고쳐도 됩니다)</li>
        <li>열 이름은 한글·영문 모두 인식합니다 — <code>제품코드</code>/<code>code</code>, <code>조립매수</code>/<code>assembly</code> …</li>
        <li><b>파일 선택</b>으로 올립니다. 제품인지 극판인지는 알아서 판별합니다.</li>
        <li><b>병합</b>(같은 코드만 덮어쓰기) 또는 <b>대체</b>(통째로 교체)를 고릅니다.</li>
        <li>검증 결과를 확인하고 <b>적용</b>을 누릅니다.</li>
      </ol>
      <div class="tip"><b>제품이 새 극판을 쓰면 극판 파일과 제품 파일을 함께 올리세요.</b> 따로 올리면 “극판 미등록”으로 반려됩니다.</div>
      <div class="warn-box">DB를 바꾸면 저장된 과제의 계산 결과가 모두 <b>재계산 필요</b>가 됩니다. 근거가 달라졌기 때문입니다 — 결재 전에 다시 계산하세요.
        올린 DB는 <b>이 PC의 브라우저에만</b> 저장됩니다. 팀 전체에 반영하려면 담당자에게 CSV를 전달해 배포본을 다시 만들어야 합니다.</div>`,
  },
  {
    n: 'B',
    title: '예측 보정하기 (시제품 실측 되먹임)',
    lead: '시제품 시험 결과를 넣으면 <b>예측식이 그만큼 똑똑해집니다.</b> 쓸수록 정확해지는 유일한 방법입니다.',
    body: `
      ${figure('13-calibration.jpg', '예측 보정 화면')}
      <ol>
        <li>지표(C20/RC/EN CCA/SAE CCA)를 고르고, <b>설계안에서 나온 예측값</b>과 <b>시험에서 나온 실측값</b>을 짝지어 등록합니다.</li>
        <li>여러 건이면 CSV로 한 번에 올릴 수 있습니다.</li>
        <li>표본이 <b>5건</b> 이상 모이면 보정식이 만들어지고, 무보정 대비 오차가 얼마나 줄어드는지 보여줍니다.</li>
        <li>확인 후 <b>보정 승인</b>을 누르면 그때부터 모든 예측에 적용됩니다.</li>
      </ol>
      <div class="tip"><b>승인 전에는 예측에 전혀 반영되지 않습니다.</b> 마음 놓고 등록해 보세요.</div>
      <div class="warn-box"><b>같은 시험조건끼리만 모으세요.</b> −18℃ EN CCA와 −29℃ SAE CCA를 섞으면 보정식이 무너집니다.
        승인이 막히면 사유가 화면에 나옵니다 — 표본 부족, 기울기 이상, 또는 “보정해도 오차가 줄지 않음”입니다.</div>`,
  },
  {
    n: 'C',
    title: '격리판 봉합은 어떻게 정해지나',
    lead: '<b>고르는 값이 아닙니다.</b> 극판 조합을 정하면 봉합 극성이 따라 나옵니다.',
    body: `
      <p>보고서와 설계 BOM에 <b>봉합</b> 열이 자동으로 붙습니다. 입력할 칸은 없습니다.</p>
      ${figure('15-separator-bom.jpg', '같은 라인업의 두 제품 — 위는 (−)봉합, 아래는 (+)봉합', '극판 조합이 다르니 봉합도 다르게 나옵니다')}

      <h4>왜 자동인가 — 사내 실적 9,319건을 세어봤습니다</h4>
      <table class="grade">
        <tr><th>무엇으로 맞히나</th><th>적중률</th></tr>
        <tr><td>무조건 (−)봉합이라고 하기</td><td>88.1% <small>(기준선)</small></td></tr>
        <tr><td>"EFB·LN이면 (+)" 같은 규칙으로 외우기</td><td class="bad">74.3% <small>— 기준선보다 나쁨</small></td></tr>
        <tr><td>제품군 실적을 따르기</td><td>95.0%</td></tr>
        <tr><td><b>극판 조합 실적을 따르기</b></td><td class="good"><b>99.7%</b></td></tr>
      </table>
      <p>사람이 외울 만한 규칙이 오히려 기준선보다 못합니다. 그래서 규칙으로 정하지 않고
         <b>같은 극판 조합을 쓴 기존 제품이 실제로 어떻게 만들어졌는지</b>를 그대로 따릅니다.</p>

      <h4>판정 순서</h4>
      <div class="flow">
        <span>극판 조합 실적</span><i>→ 없으면</i><span>제품군 실적</span><i>→ 그것도 없으면</i><span>판단 불가</span>
      </div>
      <ul>
        <li>봉합 값에 <b>마우스를 올리면</b> 근거가 나옵니다 — 예: "극판 조합 실적 11/11건".</li>
        <li>실적에 소수 예외가 섞인 조합은 <b>⚠</b>가 붙습니다. 다수파를 쓰되 <u>확인이 필요하다</u>는 뜻입니다.</li>
        <li>근거가 아예 없으면 <b>추측하지 않고</b> <code>판단 불가</code>로 둡니다. 빈칸을 억지로 채우지 않습니다.</li>
        <li>신형 극판 설계(1·2안)도 원본 극판 조합의 봉합을 따릅니다 — 같은 크기 극판을 다시 만드는 것이라
            봉합 방식이 바뀔 이유가 없기 때문입니다.</li>
      </ul>
      <div class="tip"><b>(+)봉합은 EFB 계열과 유럽 규격(LN·LBN·EN)에 몰려 있습니다.</b>
        전체 실적의 88%는 (−)봉합입니다.</div>
      <div class="warn-box">봉합은 <b>참고 정보</b>입니다. 실제 생산 사양은 공정·설비 조건에 따라 달라질 수 있으니
        신규 조합이라면 생산기술과 확인하세요.</div>`,
  },
  {
    n: 'D',
    title: '저장·백업·이어하기',
    lead: '입력하면 <b>약 1초 뒤 자동 저장</b>됩니다. 저장 버튼을 찾을 필요가 없습니다.',
    body: `
      ${figure('14-workbench-saved.jpg', '저장된 과제 목록')}
      <ul>
        <li>상단 표시가 <b>“이 브라우저에 저장됨”</b>으로 바뀌면 완료입니다.</li>
        <li>과제를 다시 열려면 워크벤치에서 목록의 과제를 누르면 됩니다.</li>
        <li><b>붉은 저장 실패 알림이 뜨면 반드시 백업 파일로 내보내세요.</b> 브라우저 저장공간이 찼다는 뜻입니다.</li>
      </ul>
      <div class="warn-box"><b>과제는 이 PC의 브라우저에만 저장됩니다.</b> 다른 PC로 옮기거나 동료와 공유하려면
        워크벤치의 <b>백업 내보내기</b>로 파일을 만들어 주고받아야 합니다. 브라우저 데이터를 지우면 과제도 사라집니다.</div>`,
  },
];

const faq = [
  ['계산이 시작되지 않아요', '요구사양에 빨간 표시가 남아 있습니다. 목표값이 비어 있으면 성능여유를 계산할 수 없어 아예 시작하지 않습니다.'],
  ['“재계산 필요”가 떴어요', '입력이나 DB·보정이 바뀌었는데 아직 다시 계산하지 않은 상태입니다. 결과를 믿기 전에 다시 계산하세요.'],
  ['성능여유가 +0%인데 괜찮나요', '계산상 통과지만 여유가 없다는 뜻입니다. <b>시제품 검증 1순위</b>로 두고, 미달이면 매수를 늘리거나 다른 기준품을 검토하세요.'],
  ['근거 D등급이 나왔어요', '그 제품군에 실적이 없다는 뜻입니다. 참고는 되지만 <b>승인 근거로는 쓸 수 없습니다.</b> DB를 갱신하거나 시제품으로 검증해야 합니다.'],
  ['매수가 생각보다 적게 나와요', '목표를 <u>모두</u> 만족하는 최소 매수를 고르기 때문입니다. 매수를 늘리고 싶으면 목표를 올리거나, 설계안 카드에서 다른 안을 보세요.'],
  ['DB 실적 범위 밖 설계를 보고 싶어요', '현재 버전은 실적 매수범위 안에서만 탐색합니다. 범위 밖은 근거가 없어 예측을 신뢰할 수 없기 때문입니다.'],
  ['6V(3셀)·24V(12셀) 제품이에요', '요구사양의 <b>셀 수</b>를 반드시 바꾸세요. 그대로 두면 원가와 납중량이 2배씩 틀립니다.'],
  ['봉합을 (+)로 바꾸고 싶은데 어디서 고르나요', '고르는 항목이 아닙니다. 봉합은 극판 조합이 정하는 값이라, 극판 조합을 바꾸면 봉합도 따라 바뀝니다. 실적과 다른 봉합이 필요하다면 그것은 새로운 사양이므로 생산기술 협의가 필요합니다.'],
  ['봉합이 "판단 불가"로 나와요', '그 극판 조합·제품군에 실적이 없다는 뜻입니다. 추측해서 채우지 않습니다. 사내 DB를 갱신하면 근거가 생겨 판정됩니다.'],
  ['봉합 옆에 ⚠ 가 붙었어요', '같은 극판 조합인데 실적에 (+)와 (−)가 섞여 있다는 뜻입니다. 다수파를 표시하지만 확인이 필요합니다. 마우스를 올리면 몇 건 중 몇 건인지 보입니다.'],
  ['슬라이더로 바꾼 값이 보고서에 안 나와요', '<b>정상입니다.</b> 실시간 조절은 화면에서만 사는 검토용 값이라 저장되지 않습니다. 보고서·BOM·원가에 반영하려면 요구사양에서 값을 바꾸고 정식으로 다시 계산하세요.'],
  ['슬라이더를 움직여도 숫자가 안 바뀌어요', '두께만 움직인 경우 C20·RC는 그대로입니다(용량은 활물질이 정합니다). 반대로 활물질만 움직이면 CCA가 그대로입니다. 다른 항목도 전혀 안 바뀐다면 「변화」 열이 “동일”인지 확인하세요 — 반올림 단위보다 작은 변화는 “동일”로 묶습니다.'],
  ['조절을 시작하니 기준값이 확정 설계와 달라요', '3안에서 기준품을 직접 지정하면 확정 설계는 그 제품의 <b>실측값</b>을 그대로 씁니다. 조절을 하면 실측이 아니라 모델로 계산되므로, 비교가 공평하도록 「기준값」 열도 같은 모델로 다시 돌린 값을 싣습니다. 카드 아래 안내문에 실측값이 함께 적혀 있습니다.'],
  ['도움말을 보고 싶어요', '오른쪽 위 <b>?</b> 아이콘 또는 <b>F1</b> 키. 지금 보고 있는 화면의 설명이 먼저 나옵니다.'],
];

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Battery Design Studio 사용가이드</title>
<style>
:root{--ink:#14221f;--muted:#65736f;--line:#dce4e1;--paper:#f5f7f6;--teal:#087c70;--teal-dark:#075e57;--teal-soft:#e8f4f1;--amber:#b8761a;--amber-soft:#fdf3e2;--red:#b6453c;--red-soft:#fdeeec;--radius:12px}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:"Pretendard","Noto Sans KR","Malgun Gothic",sans-serif;font-size:15px;line-height:1.75;-webkit-text-size-adjust:100%}
.wrap{max-width:1000px;margin:0 auto;padding:0 22px 90px}
header.top{background:linear-gradient(135deg,#0d2b27,#12463f);color:#eaf5f2;padding:44px 22px 38px;margin-bottom:34px}
header.top .inner{max-width:1000px;margin:0 auto}
header.top .eyebrow{font-size:11.5px;letter-spacing:.18em;color:#7fd4c4;font-weight:700}
header.top h1{margin:10px 0 8px;font-size:30px;letter-spacing:-.02em}
header.top p{margin:0;color:#a9c9c2;font-size:15px}
header.top .meta{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap}
header.top .meta span{background:rgba(255,255,255,.1);border-radius:999px;padding:5px 13px;font-size:12px}
nav.toc{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:20px 24px;margin-bottom:34px}
nav.toc h2{margin:0 0 12px;font-size:15px}
nav.toc ol{margin:0;padding-left:20px;columns:2;column-gap:32px}
nav.toc li{margin-bottom:5px;break-inside:avoid}
nav.toc a{color:var(--teal-dark);text-decoration:none}
nav.toc a:hover{text-decoration:underline}
section.step{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:28px 30px;margin-bottom:26px}
.step-head{display:flex;gap:16px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:18px}
.step-num{flex:none;width:44px;height:44px;border-radius:11px;background:var(--teal);color:#fff;display:grid;place-items:center;font-weight:800;font-size:16px}
.step-head h2{margin:0;font-size:21px;letter-spacing:-.01em}
.step-head .lead{margin:5px 0 0;color:var(--muted);font-size:14px}
h4{margin:26px 0 8px;font-size:16px;color:var(--teal-dark)}
figure{margin:18px 0;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:10px}
figure img{width:100%;display:block;border-radius:6px;border:1px solid var(--line)}
figcaption{margin-top:9px;font-size:12.5px;color:var(--muted);line-height:1.6}
figcaption strong{color:var(--ink)}
ol,ul{padding-left:22px}
li{margin-bottom:6px}
code{background:var(--teal-soft);color:var(--teal-dark);padding:1px 6px;border-radius:5px;font-size:13px;font-family:ui-monospace,Consolas,monospace}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13.5px}
th,td{border:1px solid var(--line);padding:8px 11px;text-align:left;vertical-align:top}
th{background:#eef3f1;font-size:12.5px;white-space:nowrap}
td.good{color:var(--teal-dark);font-weight:600}
td.warn{color:var(--amber)}
td.bad{color:var(--red);font-weight:600}
.g{display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:6px;font-weight:800;font-size:12.5px}
.gA{background:var(--teal-soft);color:var(--teal-dark)}.gB{background:#e8eef8;color:#2f5e93}.gC{background:var(--amber-soft);color:var(--amber)}.gD{background:var(--red-soft);color:var(--red)}
.tip,.warn-box{border-radius:9px;padding:12px 16px;margin:14px 0;font-size:13.5px;line-height:1.7}
.tip{background:var(--teal-soft);color:var(--teal-dark)}
.tip::before{content:"💡 ";}
.warn-box{background:var(--amber-soft);color:#7a4d0c}
.warn-box::before{content:"⚠️ ";}
details{background:#fff;border:1px solid var(--line);border-radius:9px;padding:12px 18px;margin-bottom:8px}
details summary{cursor:pointer;font-weight:600;font-size:14.5px}
details p{margin:9px 0 0;color:var(--muted);font-size:14px}
footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
.flow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:16px 0 4px}
.flow span{background:var(--teal-soft);color:var(--teal-dark);border-radius:8px;padding:7px 13px;font-size:13px;font-weight:600}
.flow i{color:var(--muted);font-style:normal}
@media(max-width:720px){nav.toc ol{columns:1}section.step{padding:20px 18px}header.top h1{font-size:24px}}
@media print{body{background:#fff}section.step,nav.toc{border:0;padding:0;margin-bottom:20px}figure{break-inside:avoid}header.top{background:#0d2b27!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<header class="top">
  <div class="inner">
    <div class="eyebrow">USER GUIDE · 신입사원용</div>
    <h1>배터리 설계 스튜디오 사용가이드</h1>
    <p>고객 요구사양을 넣으면 극판 조합·매수·원가·납중량·격리판 봉합까지 계산해 주는 오프라인 설계 도구입니다.</p>
    <div class="meta"><span>Battery Design Studio v8</span><span>설치 불필요 · 인터넷 불필요</span><span>사내 전용 · 대외비</span></div>
  </div>
</header>

<div class="wrap">

<nav class="toc">
  <h2>목차</h2>
  <ol>
    ${[...steps, ...advanced].map((s) => `<li><a href="#s${s.n}">${s.title}</a></li>`).join('\n    ')}
    <li><a href="#faq">자주 묻는 질문</a></li>
  </ol>
</nav>

<section class="step">
  <div class="step-head">
    <div class="step-num">▶</div>
    <div><h2>먼저, 전체 흐름</h2><p class="lead">왼쪽 메뉴 순서대로만 따라가면 됩니다. 처음부터 끝까지 10분이면 충분합니다.</p></div>
  </div>
  <div class="flow">
    <span>① 요구사양 입력</span><i>→</i><span>② 기존 PCC 매칭</span><i>→</i><span>③ 설계·BOM 비교</span><i>→</i><span>④ 원가·수익성</span><i>→</i><span>⑤ 보고서 출력</span>
  </div>
  <p>이 도구가 대신해 주는 것은 <b>“어떤 극판을 몇 장 쓰면 이 성능이 나오는가”</b>입니다.
     사내 실적 제품 740건을 근거로 계산하며, 근거가 얼마나 두터운지를 <b>A~D 등급</b>으로 항상 함께 알려줍니다.</p>
  <div class="warn-box">이 도구는 <b>설계 검토를 돕는 것</b>이지 시제품 시험이나 Gate 승인을 대신하지 않습니다.
    케이스 도면·단자 위치·패킹 호환성은 판정하지 않으니 반드시 별도로 확인하세요.</div>
</section>

${steps.map((s) => `
<section class="step" id="s${s.n}">
  <div class="step-head">
    <div class="step-num">${s.n}</div>
    <div><h2>${s.title}</h2><p class="lead">${s.lead}</p></div>
  </div>
  ${s.body}
</section>`).join('\n')}

<section class="step">
  <div class="step-head">
    <div class="step-num" style="background:#2f5e93">＋</div>
    <div><h2>익숙해지면 쓰는 기능</h2><p class="lead">기본 흐름만으로도 충분합니다. 아래는 필요할 때 찾아보세요.</p></div>
  </div>
</section>

${advanced.map((s) => `
<section class="step" id="s${s.n}">
  <div class="step-head">
    <div class="step-num" style="background:#2f5e93">${s.n}</div>
    <div><h2>${s.title}</h2><p class="lead">${s.lead}</p></div>
  </div>
  ${s.body}
</section>`).join('\n')}

<section class="step" id="faq">
  <div class="step-head">
    <div class="step-num" style="background:#5b6b67">?</div>
    <div><h2>자주 묻는 질문</h2><p class="lead">막혔을 때 여기부터 찾아보세요.</p></div>
  </div>
  ${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('\n  ')}
</section>

<footer>
  <span>Battery Design Studio v8 · 사내 실적 제품 740건 · 극판 120건 기준</span>
  <span>화면 캡처는 실제 프로그램 화면입니다 · 사내 전용</span>
</footer>

</div>
</body>
</html>`;

writeFileSync(outFile, html, 'utf8');
console.log(`사용가이드 저장 → ${outFile}`);
console.log(`  ${(html.length / 1048576).toFixed(1)}MB · 화면 캡처 ${[...steps, ...advanced].reduce((n, s) => n + (s.body.match(/<figure>/g) || []).length, 0)}장 포함`);
