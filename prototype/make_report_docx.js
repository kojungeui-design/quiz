// 배터리 기본성능시험 결과 기안서 자동 생성 (docx-js)
// 입력: prototype/out/report_data.json  →  출력: prototype/out/기안서_기본성능시험결과.docx
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} = require("docx");

const D = JSON.parse(fs.readFileSync("prototype/out/report_data.json", "utf8"));
const FONT = "맑은 고딕";
const NAVY = "004094", HEAD = "1F3864", LINE = "BFBFBF";
const GRAY = "F2F5F9", PASS = "1A8F5C", FAIL = "C00000";

const TODAY = "2025-11-28"; // 기안일 (실제 생성 시 당일로 대체)

// ---- helpers ----
const T = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || 20, bold: o.bold, color: o.color, italics: o.italics });
const P = (runs, o = {}) => new Paragraph({ children: Array.isArray(runs) ? runs : [runs], spacing: { after: o.after ?? 80, before: o.before ?? 0, line: 276 }, alignment: o.align });
const H = (text, lvl = HeadingLevel.HEADING_1) => new Paragraph({
  heading: lvl, spacing: { before: 240, after: 120 },
  children: [new TextRun({ text, font: FONT, bold: true, size: lvl === HeadingLevel.HEADING_1 ? 26 : 22, color: HEAD })],
});
const B = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const BORDERS = { top: B, bottom: B, left: B, right: B };
function cell(text, w, o = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: BORDERS,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: "auto" } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    verticalAlign: "center",
    children: [new Paragraph({
      alignment: o.align || AlignmentType.CENTER,
      children: [new TextRun({ text: String(text), font: FONT, size: 18, bold: o.bold, color: o.color })],
    })],
  });
}
const rowH = (cells) => new TableRow({ tableHeader: true, children: cells });
function table(colW, rows) {
  return new Table({
    columnWidths: colW, width: { size: colW.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    rows,
  });
}

// ---- 결재란 ----
const approvalW = [1400, 1400, 1400, 1400];
const approvalTable = table(approvalW, [
  new TableRow({ children: ["기안", "검토", "부서장", "승인"].map(t => cell(t, 1400, { shade: GRAY, bold: true })) }),
  new TableRow({ children: approvalW.map(() => new TableCell({ width: { size: 1400, type: WidthType.DXA }, borders: BORDERS, children: [new Paragraph({ text: "" }), new Paragraph({ text: "" })] })) }),
]);

// ---- 1. 개요 표 ----
const running = D.samples.some(s => s.running);
const overviewW = [2200, 6800];
const overview = table(overviewW, [
  ["시험 명", `${D.model} 기본성능시험 (${D.samples[0].section.replace(/#\d+$/, "")} 계열)`],
  ["대상 모델", `${D.model}  (${D.spec})`],
  ["시험 프로그램", [...new Set(D.samples.map(s => s.program))].join(", ")],
  ["시험 대수", `${D.n} 대 (샘플 ${D.samples.map(s => s.sample).join(", ")})`],
  ["시험 시작", D.samples[0].start],
  ["진행 상태", running ? "일부 진행 중 (중간결과 기준)" : "종료"],
].map(([k, v]) => new TableRow({ children: [cell(k, 2200, { shade: GRAY, bold: true, align: AlignmentType.LEFT }), cell(v, 6800, { align: AlignmentType.LEFT })] })));

// ---- 2. 샘플 정보 표 ----
const sInfoW = [1100, 1400, 1300, 1300, 1300, 1300, 1300];
const sInfoRows = [rowH(["샘플", "회로(PC)", "중량(g)", "초기전압(V)", "내부저항(mΩ)", "MCCA", "시험시작"].map((t, i) => cell(t, sInfoW[i], { shade: NAVY, bold: true, color: "FFFFFF" })))];
D.samples.forEach(s => sInfoRows.push(new TableRow({ children: [
  cell(s.sample, sInfoW[0], { bold: true }), cell(s.pc, sInfoW[1]), cell(s.weight ?? "-", sInfoW[2]),
  cell(s.voltage_init ?? "-", sInfoW[3]), cell(s.resistance ?? "-", sInfoW[4]), cell(s.mcca ?? "-", sInfoW[5]), cell(s.start, sInfoW[6]),
] })));
const sInfo = table(sInfoW, sInfoRows);

// ---- 3. 기본성능시험 결과 표 ----
const rW = [1100, 1900, 1900, 1900, 2200];
const rRows = [rowH(["샘플", "충전용량(Ah)", "총방전용량(Ah)", "안정화전압 24h(V)", "판정"].map((t, i) => cell(t, rW[i], { shade: NAVY, bold: true, color: "FFFFFF" })))];
D.samples.forEach(s => {
  const cap2 = s.charge_caps.length ? s.charge_caps[s.charge_caps.length - 1] : "-";
  const stab24 = s.stab.length > 1 ? s.stab[1] : (s.stab[0] ?? "-");
  const vlabel = { PASS: "합격", FAIL: "불합격", HOLD: "판정보류", "N/A": "해당없음" }[s.verdict];
  const vcolor = s.verdict === "PASS" ? PASS : s.verdict === "FAIL" ? FAIL : "808080";
  rRows.push(new TableRow({ children: [
    cell(s.sample, rW[0], { bold: true }),
    cell(cap2, rW[1]), cell(s.total_discharge || "-", rW[2]), cell(stab24, rW[3]),
    cell(vlabel, rW[4], { bold: true, color: vcolor }),
  ] }));
});
const rTable = table(rW, rRows);

// ---- 4. C20 SOC-OCV 표 ----
const socSamples = D.samples.filter(s => s.soc_curve && s.soc_curve.length >= 8);
const cW = [1600, ...socSamples.map(() => Math.floor(7400 / socSamples.length))];
const cHeader = rowH([cell("SOC (%)", cW[0], { shade: NAVY, bold: true, color: "FFFFFF" }),
  ...socSamples.map((s, i) => cell(`${s.sample} 전압(V)`, cW[i + 1], { shade: NAVY, bold: true, color: "FFFFFF" }))]);
const cRows = [cHeader];
D.soc_labels.forEach((soc, idx) => cRows.push(new TableRow({ children: [
  cell(soc, cW[0], { shade: GRAY, bold: true }),
  ...socSamples.map((s, i) => cell(s.soc_curve[idx] ?? "-", cW[i + 1])),
] })));
const cTable = table(cW, cRows);

// ---- 5. 특이사항 ----
const notableParas = [];
const allNotable = D.samples.flatMap(s => s.notable.map(n => ({ s: s.sample, n })));
if (allNotable.length === 0) notableParas.push(P(T("특이사항 없음.")));
else allNotable.forEach(x => notableParas.push(new Paragraph({
  bullet: { level: 0 }, spacing: { after: 60 },
  children: [T(`(${x.s}) ${x.n.replace(/^\[(ALARM|WARN)\]\s*/, "")}`, { size: 19 })],
})));

// ---- 6. 종합의견 ----
const passList = D.samples.filter(s => s.verdict === "PASS").map(s => s.sample);
const opinion = `${D.model} 기본성능시험 결과, 시험 대상 ${D.n}대 중 ${D.n_pass}대(${passList.join(", ")})가 규격 기준을 만족(합격)하였음. ` +
  (running ? "일부 시료는 시험 진행 중으로 중간결과 기준이며, 종료 후 최종 확정 예정임. " : "") +
  (allNotable.length ? `단, 특이사항 ${allNotable.length}건이 자동 감지되어 아래 조치가 필요함. ` : "") +
  "상기 결과를 검토하여 후속 수명시험 진행 여부를 결정하고자 함.";

// ---- 문서 조립 ----
const doc = new Document({
  creator: "시험데이터 자동화", title: "기본성능시험 결과 기안서",
  styles: { default: { document: { run: { font: FONT, size: 20 } } } },
  sections: [{
    properties: {},
    children: [
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [T(`문서번호: TEST-${TODAY.replace(/-/g, "")}-L6`, { size: 16, color: "808080" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "기 안 서", font: FONT, bold: true, size: 40, color: NAVY })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "배터리 기본성능시험 결과 보고", font: FONT, bold: true, size: 24 })] }),
      approvalTable,
      P([T(`기안일: ${TODAY}      기안부서: 제품개발      작성: 시험담당`, { size: 18, color: "595959" })], { before: 160, after: 40 }),
      new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY } }, spacing: { after: 120 } }),

      H("1. 시험 개요"), overview,
      H("2. 시험 대상 샘플"),
      P(T("각 시료의 초기 특성(중량·전압·내부저항·MCCA)은 아래와 같음.", { size: 18, color: "595959" })),
      sInfo,
      H("3. 기본성능시험 결과"),
      P(T("BTS-600 측정 데이터에서 자동 추출한 값임 (담당자 수기 대조 결과 일치 확인).", { size: 18, color: "595959" })),
      rTable,
      H("4. C20 SOC-OCV 방전 특성"),
      P(T("충전상태(SOC)별 개방회로전압(OCV) — 방전 곡선.", { size: 18, color: "595959" })),
      cTable,
      H("5. 판정 및 특이사항"),
      ...notableParas,
      H("6. 종합 의견"),
      P(T(opinion)),
      new Paragraph({ spacing: { before: 240 }, alignment: AlignmentType.RIGHT, children: [T("— 이 문서는 시험데이터에서 자동 생성된 기안 초안입니다. 검토 후 결재 바랍니다. —", { size: 16, italics: true, color: "808080" })] }),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("prototype/out/기안서_기본성능시험결과.docx", buf);
  console.log("saved prototype/out/기안서_기본성능시험결과.docx");
});
