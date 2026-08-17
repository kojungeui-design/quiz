/**
 * src/core/storage.js — 프로젝트 저장.
 *
 * 구버전의 문제 세 가지를 여기서 정리한다.
 *   · 도움말은 "자동 저장됨"이라 안내했지만 실제로는 저장 버튼을 눌러야만 저장됐다 → 진짜 자동저장을 넣는다.
 *   · localStorage.setItem 이 try 없이 상태 갱신 함수 안에서 실행됐다 → 용량 초과 시 앱이 죽었다.
 *   · 저장 실패가 조용히 지나갔다 → 실패는 반드시 화면에 알린다.
 */

const PROJECT_KEY = 'bds-v8-projects';
const LEGACY_KEYS = ['battery-design-studio-projects-v5', 'battery-design-studio-projects-v4'];
const AUTOSAVE_DELAY = 1200;

/** 결과 스냅샷은 용량을 많이 먹는다. 저장에는 다시 계산할 수 있는 부분을 뺀 요약만 싣는다. */
function compactProject(project) {
  const snapshot = project.resultSnapshot;
  return {
    ...project,
    resultSnapshot: snapshot
      ? {
          kind: snapshot.kind,
          label: snapshot.label,
          averageCost: snapshot.averageCost,
          developmentCost: snapshot.developmentCost,
          commonFamilies: snapshot.commonFamilies,
          commonization: snapshot.commonization,
          commonizedVolumeShare: snapshot.commonizedVolumeShare,
          score: snapshot.score,
          designs: snapshot.designs.map((d) => ({
            uid: d.spec.uid,
            name: d.spec.name,
            group: d.spec.group,
            referenceCode: d.reference?.code,
            familyKey: d.compatibility.familyKey,
            plateCount: d.plateCount,
            posCode: d.posCode,
            negCode: d.negCode,
            predictedC20: d.predictedC20,
            predictedRc: d.predictedRc,
            predictedEnCca: d.predictedEnCca,
            predictedSaeCca: d.predictedSaeCca,
            c20Margin: d.c20Margin,
            rcMargin: d.rcMargin,
            ccaMargin: d.ccaMargin,
            saeMargin: d.saeMargin,
            unitCost: d.unitCost,
            evidenceGrade: d.evidenceGrade,
            confidence: d.confidence,
            warning: d.warning,
          })),
        }
      : null,
  };
}

export function loadProjects() {
  for (const key of [PROJECT_KEY, ...LEGACY_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (error) {
      console.warn(`[storage] ${key} 읽기 실패`, error);
    }
  }
  return [];
}

/**
 * 저장 결과를 반드시 반환한다. 호출한 쪽이 실패를 화면에 알릴 수 있도록.
 * @returns {{ok: true, bytes: number} | {ok: false, reason: string, message: string}}
 */
export function saveProjects(projects) {
  let payload;
  try {
    payload = JSON.stringify(projects.map(compactProject));
  } catch (error) {
    return { ok: false, reason: 'serialize', message: `저장할 데이터를 만들지 못했습니다: ${error.message}` };
  }
  try {
    localStorage.setItem(PROJECT_KEY, payload);
    return { ok: true, bytes: payload.length };
  } catch (error) {
    const quotaExceeded =
      error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22;
    return {
      ok: false,
      reason: quotaExceeded ? 'quota' : 'unknown',
      message: quotaExceeded
        ? `브라우저 저장공간이 가득 찼습니다(${Math.round(payload.length / 1024)}KB). 오래된 과제를 지우거나 백업 파일로 내보낸 뒤 다시 시도하세요.`
        : `저장하지 못했습니다: ${error.message}`,
    };
  }
}

export function storageUsage() {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    return { bytes: raw ? raw.length : 0, limit: 5 * 1024 * 1024 };
  } catch {
    return { bytes: 0, limit: 5 * 1024 * 1024 };
  }
}

/**
 * 자동저장기. 변경 신호를 받으면 잠깐 기다렸다가 저장한다.
 * 저장 중·저장됨·실패 상태를 콜백으로 알려 화면 표시와 어긋나지 않게 한다.
 */
export function createAutosave({ getProjects, onStateChange }) {
  let timer = null;
  let pending = false;

  const flush = () => {
    if (!pending) return { ok: true, bytes: 0 };
    clearTimeout(timer);
    timer = null;
    onStateChange({ state: 'saving', label: '저장 중…' });
    const result = saveProjects(getProjects());
    /**
     * 저장에 실패하면 미저장 상태를 <b>그대로 둔다.</b>
     *
     * 무조건 pending = false 로 내리던 때는, 저장이 실패해도 "저장할 것이 없다"가 되어
     * 창을 닫을 때 뜨는 확인창이 사라졌다. 용량 초과로 저장이 안 된 사용자가
     * 아무 경고 없이 작업을 잃는 길이었다. 실패했으면 아직 저장할 것이 남은 것이 맞다.
     */
    pending = !result.ok;
    onStateChange(
      result.ok
        ? { state: 'saved', label: '이 브라우저에 저장됨', bytes: result.bytes }
        : { state: 'error', label: '저장 실패 · 미저장 변경 유지', message: result.message },
    );
    return result;
  };

  return {
    /** 변경 발생. 연달아 불려도 마지막 한 번만 저장한다. */
    schedule() {
      pending = true;
      onStateChange({ state: 'dirty', label: '변경사항 있음' });
      clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_DELAY);
    },
    /** 지금 즉시 저장(화면 이동·저장 버튼·창 닫기 직전). */
    flush,
    get hasPending() {
      return pending;
    },
  };
}

/** 저장 안 된 변경이 있는 채로 창을 닫으려 하면 브라우저 확인창을 띄운다. */
export function guardUnload(hasUnsavedChanges) {
  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

/* ---------- 백업 / 복원 ---------- */

export function backupPayload(projects) {
  return JSON.stringify(
    { schema: 'bds-backup-v8', createdAt: new Date().toISOString(), projects: projects.map(compactProject) },
    null,
    2,
  );
}

export function parseBackup(text) {
  const parsed = JSON.parse(text);
  if (parsed.schema === 'bds-backup-v8' && Array.isArray(parsed.projects)) return parsed.projects;
  // 구버전 백업(bds-commercial-backup-v1)도 받아준다.
  if (parsed.schema === 'bds-commercial-backup-v1' && parsed.storage) {
    for (const key of ['battery-design-studio-projects-v5', 'battery-design-studio-projects-v4']) {
      if (parsed.storage[key]) {
        const projects = JSON.parse(parsed.storage[key]);
        if (Array.isArray(projects)) return projects;
      }
    }
  }
  throw new Error('지원하지 않는 백업 형식입니다.');
}
