/**
 * src/views/calibration.js — 시제품 실측으로 예측식을 보정한다.
 *
 * 이 화면의 목적은 "보정을 쉽게 켜는 것"이 아니라 "근거 없는 보정을 못 켜게 하는 것"이다.
 * 그래서 적합 결과보다 승인 조건과 무보정 대비 개선폭을 먼저 보여준다.
 */
import { h, icon, table } from '../lib/dom.js';
import { num, pct, dateLabel } from '../core/format.js';
import { downloadCsv } from '../core/export.js';
import {
  CALIBRATION_METRICS,
  MIN_CALIBRATION_SAMPLES,
  calibrationSummary,
  addCalibrationSamples,
  removeCalibrationSample,
  setCalibrationApproval,
  parseCalibrationCsv,
  calibrationTemplateRows,
  calibrationBackupRows,
} from '../core/calibration.js';
import { sectionHead, notice, numberField, textField, selectField } from './parts.js';

export function renderCalibration(ctx) {
  const summary = calibrationSummary(ctx.calibration);
  const activeMetrics = summary.filter((m) => m.active);

  const commit = (next, message) => {
    const result = ctx.setCalibration(next);
    if (!result.ok) {
      ctx.toast(result.message, 'error', 9000);
      return false;
    }
    if (message) ctx.toast(message, 'success', 4500);
    return true;
  };

  /* ---------------------- 실측 등록 ---------------------- */

  const draft = { metric: 'encca', product: '', predicted: 0, observed: 0 };

  const addOne = () => {
    if (!draft.product.trim()) return ctx.toast('시제품 이름을 입력하세요.', 'warn');
    if (!(draft.predicted > 0) || !(draft.observed > 0)) return ctx.toast('예측값과 실측값을 모두 입력하세요.', 'warn');
    commit(
      addCalibrationSamples(ctx.calibration, draft.metric, [
        { product: draft.product, predicted: draft.predicted, observed: draft.observed },
      ]),
      '실측을 등록했습니다.',
    );
  };

  const fileInput = h('input', {
    type: 'file',
    accept: '.csv',
    'aria-label': '실측 CSV 선택',
    onchange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const parsed = parseCalibrationCsv(await file.text(), draft.metric);
        if (!parsed.rows.length) {
          ctx.toast(`읽을 수 있는 행이 없습니다. ${parsed.issues[0]?.message || ''}`, 'error', 9000);
          return;
        }
        // 지표별로 나눠 담는다. 한 파일에 여러 지표를 섞어 올릴 수 있다.
        let next = ctx.calibration;
        const byMetric = new Map();
        for (const row of parsed.rows) {
          if (!byMetric.has(row.metric)) byMetric.set(row.metric, []);
          byMetric.get(row.metric).push(row);
        }
        for (const [metric, rows] of byMetric) next = addCalibrationSamples(next, metric, rows);
        if (!commit(next)) return;
        const detail = [...byMetric].map(([m, r]) => `${CALIBRATION_METRICS.find((x) => x.key === m).label} ${r.length}건`).join(', ');
        ctx.toast(
          `${detail} 등록했습니다.${parsed.issues.length ? ` (${parsed.issues.length}건은 읽지 못해 건너뛰었습니다)` : ''}`,
          parsed.issues.length ? 'warn' : 'success',
          7000,
        );
      } catch (error) {
        ctx.toast(`${file.name}: ${error.message}`, 'error', 9000);
      }
    },
  });

  const entryCard = h(
    'section.card',
    null,
    h(
      'header.card-head',
      null,
      h('h3', null, '시제품 실측 등록'),
      h(
        'div.card-tools',
        null,
        h('button.link-button', { type: 'button', onclick: () => downloadCsv('실측_양식.csv', calibrationTemplateRows()) }, 'CSV 양식'),
        h(
          'button.link-button',
          { type: 'button', onclick: () => downloadCsv('보정표본_백업.csv', calibrationBackupRows(ctx.calibration)) },
          '표본 내보내기',
        ),
      ),
    ),
    h(
      'p.card-note',
      null,
      '설계안에 나온 예측값과 시제품 시험에서 나온 실측값을 짝지어 등록합니다. 같은 시험조건(온도·충전상태)끼리 모아야 의미가 있습니다.',
    ),
    h(
      'div.calib-entry',
      null,
      selectField({
        label: '지표',
        value: draft.metric,
        options: CALIBRATION_METRICS.map((m) => ({ value: m.key, label: m.label })),
        onChange: (value) => {
          draft.metric = value;
        },
      }),
      textField({ label: '시제품', value: '', placeholder: '예: LN2 시제품 1차', onInput: (value) => { draft.product = value; } }),
      numberField({ label: '예측값', value: 0, min: 0, onInput: (value) => { draft.predicted = value; } }),
      numberField({ label: '실측값', value: 0, min: 0, onInput: (value) => { draft.observed = value; } }),
      h('button.primary-button', { type: 'button', onclick: addOne }, icon('plus', 15), ' 등록'),
    ),
    h('div.import-drop', null, h('label.secondary-button.file-button', null, icon('download', 15), ' CSV로 여러 건 등록', fileInput)),
  );

  /* ---------------------- 지표별 카드 ---------------------- */

  const metricCard = (metric) => {
    const { fit, eligibility, samples, approved, active } = metric;
    const unit = metric.unit;

    const approveButton = h(
      `button.${approved ? 'secondary-button' : 'primary-button'}`,
      {
        type: 'button',
        disabled: !approved && !eligibility.ok,
        title: !approved && !eligibility.ok ? eligibility.reasons.join(' ') : null,
        onclick: async () => {
          if (approved) {
            const confirmed = await ctx.confirmAction({
              title: `${metric.label} 보정을 해제할까요?`,
              message: '예측값이 보정 전으로 돌아가고, 저장된 계산 결과는 모두 재계산 필요 상태가 됩니다.',
              confirmLabel: '해제',
              danger: true,
            });
            if (!confirmed) return;
            const next = setCalibrationApproval(ctx.calibration, metric.key, false);
            commit(next.calibration, `${metric.label} 보정을 해제했습니다.`);
            return;
          }
          const confirmed = await ctx.confirmAction({
            title: `${metric.label} 보정을 승인할까요?`,
            message:
              `표본 ${fit.n}건으로 만든 보정식이 지금부터 모든 ${metric.label} 예측에 적용됩니다. ` +
              `평균오차가 ${pct(fit.baselineMape, 1)} → ${pct(fit.mape, 1)} 로 줄어듭니다. ` +
              '저장된 계산 결과는 모두 재계산 필요 상태가 됩니다.',
            confirmLabel: '승인',
          });
          if (!confirmed) return;
          const next = setCalibrationApproval(ctx.calibration, metric.key, true);
          if (!next.ok) {
            ctx.toast(next.message, 'error', 9000);
            return;
          }
          commit(next.calibration, `${metric.label} 보정을 승인했습니다.`);
        },
      },
      approved ? '보정 해제' : '보정 승인',
    );

    return h(
      'section.card',
      null,
      h(
        'header.card-head',
        null,
        h(
          'div',
          null,
          h('h3', null, metric.label),
          h(
            'p.card-note',
            null,
            active
              ? `보정 적용 중 · 승인 ${dateLabel(metric.approvedAt)}`
              : approved
                ? '승인되었지만 조건을 더 이상 만족하지 않아 적용되지 않습니다.'
                : '보정 없음 — 예측값을 그대로 씁니다.',
          ),
        ),
        h('span', { class: `calib-state ${active ? 'on' : 'off'}` }, active ? '적용 중' : '미적용'),
      ),

      fit
        ? h(
            'div.kpi-row.compact',
            null,
            calibKpi('표본', num(fit.n), '건'),
            calibKpi('보정식', `${fit.slope.toFixed(3)}x ${fit.intercept >= 0 ? '+' : '−'} ${Math.abs(fit.intercept).toFixed(1)}`, unit),
            calibKpi('R²', fit.r2.toFixed(3), fit.r2 >= 0.9 ? '설명력 높음' : fit.r2 >= 0.7 ? '보통' : '낮음'),
            calibKpi('평균오차', pct(fit.mape, 1), `무보정 ${pct(fit.baselineMape, 1)}`),
            calibKpi('예측 편향', `${fit.meanBias >= 0 ? '+' : ''}${num(fit.meanBias, 1)}%`, fit.meanBias >= 0 ? '예측이 높게 나옴' : '예측이 낮게 나옴'),
          )
        : notice('info', `표본이 ${MIN_CALIBRATION_SAMPLES}건 이상 모이면 보정식을 만들 수 있습니다. 지금 ${samples.length}건.`),

      fit && !eligibility.ok
        ? notice('warn', `승인할 수 없습니다 — ${eligibility.reasons.join(' ')}`)
        : null,

      fit && eligibility.ok && !approved
        ? notice('info', `표본 예측 범위는 ${num(fit.range[0], 1)}~${num(fit.range[1], 1)} ${unit} 입니다. 이 범위를 크게 벗어난 설계에는 외삽이 되므로 주의하세요.`)
        : null,

      samples.length
        ? table(
            [
              { label: '시제품', key: 'product' },
              { label: '예측', align: 'right', format: (s) => `${num(s.predicted, metric.digits)} ${unit}` },
              { label: '실측', align: 'right', format: (s) => `${num(s.observed, metric.digits)} ${unit}` },
              { label: '오차', align: 'right', format: (s) => `${s.predicted >= s.observed ? '+' : ''}${num(((s.predicted - s.observed) / s.observed) * 100, 1)}%` },
              { label: '비고', format: (s) => s.note || '—' },
              {
                label: '',
                format: (s) =>
                  h(
                    'button.icon-button.danger',
                    {
                      type: 'button',
                      'aria-label': `${s.product} 표본 삭제`,
                      onclick: () => commit(removeCalibrationSample(ctx.calibration, metric.key, s.id), '표본을 지웠습니다.'),
                    },
                    icon('trash', 15),
                  ),
              },
            ],
            samples,
          )
        : null,

      h('div.card-actions', null, approveButton),
    );
  };

  return h(
    'div.view',
    null,
    sectionHead({
      eyebrow: 'CALIBRATION',
      title: '예측 보정',
      description: '시제품 실측을 예측식에 되먹여, 쓸수록 정확해지게 만듭니다.',
    }),

    activeMetrics.length
      ? notice(
          'ok',
          `보정 적용 중 — ${activeMetrics.map((m) => `${m.label}(n=${m.fit.n}, R²=${m.fit.r2.toFixed(2)})`).join(', ')}. ` +
            '이 지표의 예측값은 보정식을 거친 값이며, 보고서에도 그렇게 표기됩니다.',
        )
      : notice('info', '지금은 어떤 지표도 보정되지 않았습니다. 예측값을 그대로 쓰고 있습니다.'),

    entryCard,
    ...summary.map(metricCard),

    h(
      'section.card',
      null,
      h('h3', null, '보정을 쓸 때 지켜야 할 것'),
      h(
        'ul.calib-rules',
        null,
        h('li', null, `표본은 ${MIN_CALIBRATION_SAMPLES}건 이상이어야 합니다. 계수 2개를 3건으로 뽑으면 잡음을 학습합니다.`),
        h('li', null, '같은 시험조건끼리만 모으세요. −18℃ EN CCA와 −29℃ SAE CCA를 섞으면 기울기가 무너집니다.'),
        h('li', null, '보정이 무보정보다 오차가 크면 승인 자체가 막힙니다. 고쳐서 더 나빠지는 보정은 보정이 아닙니다.'),
        h('li', null, '표본을 더하거나 지우면 승인이 자동으로 풀립니다. 승인한 사람이 본 데이터와 적용되는 데이터는 같아야 합니다.'),
        h('li', null, '표본 예측 범위를 크게 벗어난 설계에는 외삽이 됩니다. 새 제품군을 다룰 때는 보정을 다시 검토하세요.'),
        h('li', null, '보정은 이 브라우저에만 저장됩니다. 팀에 공유하려면 표본 CSV를 내보내 함께 등록해야 합니다.'),
      ),
    ),
  );
}

const calibKpi = (label, value, unit) => h('div.kpi', null, h('span', null, label), h('strong', null, value), h('small', null, unit));
