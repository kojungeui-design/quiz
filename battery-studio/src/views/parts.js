/**
 * src/views/parts.js — 화면들이 함께 쓰는 조각들.
 */
import { h, icon } from '../lib/dom.js';
import { margin, marginClass, GRADE_NOTE } from '../core/format.js';

export function sectionHead({ eyebrow, title, description, actions = [] }) {
  return h(
    'header.section-head',
    null,
    h('div', null, eyebrow && h('span.eyebrow', null, eyebrow), h('h2', null, title), description && h('p', null, description)),
    actions.length ? h('div.head-actions', null, actions) : null,
  );
}

/** 이전/다음 단계 이동 줄. 모든 작업 화면 아래에 같은 자리에 놓는다. */
export function stepNav(ctx, { back, next, nextLabel, onNext, nextDisabled }) {
  return h(
    'div.step-nav',
    null,
    back ? h('button.secondary-button', { type: 'button', onclick: () => ctx.goto(back.view) }, icon('arrowLeft', 15), ` ${back.label}`) : h('span'),
    next || onNext
      ? h(
          'button.primary-button',
          {
            type: 'button',
            disabled: !!nextDisabled,
            title: nextDisabled || null,
            onclick: () => (onNext ? onNext() : ctx.goto(next)),
          },
          nextLabel,
          ' ',
          icon('arrowRight', 15),
        )
      : null,
  );
}

/** 성능여유 칩. 목표 미입력(null)이면 회색으로 분명히 구분한다. */
export const marginChip = (label, value) =>
  h('span', { class: `margin-chip ${marginClass(value)}` }, h('b', null, label), margin(value));

export const gradeChip = (grade) => h(`span.grade-chip.grade-${grade}`, { title: GRADE_NOTE[grade] }, grade);

/**
 * 숫자 입력. 값이 바뀌면 곧바로 상태에 반영하고, 범위를 벗어나면 그 자리에서 알린다.
 * 화면 전체를 다시 그리지 않으므로 입력 중 포커스가 튀지 않는다.
 */
export function numberField({ label, unit, value, min, max, step, hint, ariaLabel, onInput, softRange }) {
  const message = h('small.field-message');
  const input = h('input', {
    type: 'number',
    value,
    min: min ?? null,
    max: max ?? null,
    step: step ?? null,
    'aria-label': ariaLabel || label,
    inputmode: 'decimal',
  });

  const validate = () => {
    const raw = input.value;
    input.classList.remove('field-error', 'field-warn');
    if (raw === '') {
      input.classList.add('field-error');
      message.textContent = '값을 입력하세요.';
      message.className = 'field-message error';
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      input.classList.add('field-error');
      message.textContent = '숫자만 입력할 수 있습니다.';
      message.className = 'field-message error';
      return null;
    }
    if (min !== undefined && parsed < min) {
      input.classList.add('field-error');
      message.textContent = `${min} 이상이어야 합니다.`;
      message.className = 'field-message error';
      return parsed;
    }
    if (softRange && (parsed < softRange[0] || parsed > softRange[1])) {
      input.classList.add('field-warn');
      message.textContent = `일반적인 범위(${softRange[0].toLocaleString('ko-KR')}~${softRange[1].toLocaleString('ko-KR')}${unit || ''})를 벗어났습니다. 오타가 아닌지 확인하세요.`;
      message.className = 'field-message warn';
      return parsed;
    }
    message.textContent = hint || '';
    message.className = 'field-message';
    return parsed;
  };

  input.addEventListener('input', () => {
    const parsed = validate();
    onInput(parsed === null ? 0 : parsed);
  });
  validate();

  return h('label.field', null, h('span.field-label', null, label), h('div.field-input', null, input, unit && h('b', null, unit)), message);
}

export function selectField({ label, value, options, ariaLabel, onChange }) {
  const select = h(
    'select',
    { 'aria-label': ariaLabel || label, onchange: (event) => onChange(event.target.value) },
    options.map((option) =>
      h('option', { value: option.value, selected: option.value === value }, option.label),
    ),
  );
  return h('label.field', null, h('span.field-label', null, label), h('div.field-input', null, select));
}

export function textField({ label, value, placeholder, onInput }) {
  return h(
    'label.field',
    null,
    h('span.field-label', null, label),
    h(
      'div.field-input',
      null,
      h('input', { type: 'text', value: value ?? '', placeholder: placeholder || '', oninput: (event) => onInput(event.target.value) }),
    ),
  );
}

/** 화면 상단의 경고 줄. 계산이 왜 막혔는지 등 사용자가 바로 조치할 내용만 담는다. */
export const notice = (kind, message, action) =>
  h('div', { class: `notice ${kind}` }, icon(kind === 'error' ? 'alert' : 'alert', 16), h('span', null, message), action || null);
