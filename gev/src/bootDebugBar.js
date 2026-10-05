// @ts-nocheck
/**
 * Bottom-of-screen boot / load debug bar.
 *
 * Visible over the full-screen loading cover so a hung Cesium viewer is not
 * a silent black box. Pure reducers are exported for tests; the DOM layer
 * is a singleton mounted once from the React shell and main.js.
 */

export const BOOT_STALL_MS = 8000;
export const BOOT_EVENT_LIMIT = 24;
export const TILESET_TIMEOUT_MS = 15000;

export const PHASE_STALL_HINTS = Object.freeze({
  engine: 'The Cesium engine bundle is still downloading. A slow network or a blocked module would stall here.',
  webgl: 'WebGL context creation stalled. Hardware acceleration may be disabled in this browser.',
  assets: 'Cesium workers at /cesium/Workers did not answer. The globe cannot start without them.',
  viewer: 'Cesium is still constructing the viewer. Usually a slow GPU shader compile, a blocked worker, or a WebGL context that never returns.',
  tiles: 'Photorealistic 3D tiles have not returned. Without keys the globe should fall back — a hanging tiles request prevents that.',
  stack: 'The map source is still switching. A blocked imagery or terrain endpoint would stall here.',
  systems: 'The canvas exists, but HUD and live-data systems have not finished attaching.',
  restore: 'Startup is waiting to restore the shared camera and layer state.',
});

const TERMINAL_STATUSES = new Set(['ok', 'warn', 'error']);

export function formatElapsed(ms) {
  const seconds = Math.max(0, Number(ms) || 0) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

export function stallHintForPhase(phaseId) {
  return PHASE_STALL_HINTS[phaseId] || 'This step is taking longer than expected. The bar will keep waiting and report the error if one lands.';
}

export function createBootDebugState(now = 0) {
  return {
    startedAt: now,
    overall: 'booting',
    currentPhaseId: null,
    phases: [],
    events: [],
    errors: [],
    probes: {
      webgl: null,
      assets: null,
      canvas: null,
      tileset: null,
      mapStack: null,
    },
    runtime: {
      elapsedMs: 0,
      layersEnabled: 0,
      layersLoading: 0,
      layersError: 0,
      mapStack: '',
      mapError: '',
    },
  };
}

function pushEvent(events, event) {
  const next = [...events, event];
  return next.length > BOOT_EVENT_LIMIT ? next.slice(-BOOT_EVENT_LIMIT) : next;
}

function closeOpenPhases(phases, exceptId, at, status = 'ok') {
  return phases.map((phase) => {
    if (phase.id === exceptId) return phase;
    if (TERMINAL_STATUSES.has(phase.status)) return phase;
    return {
      ...phase,
      status,
      endedAt: at,
      durationMs: Math.max(0, at - phase.startedAt),
    };
  });
}

export function applyBootPhase(state, {
  id,
  label,
  status = 'pending',
  detail = '',
  at = 0,
} = {}) {
  if (!id) return state;
  const existingIndex = state.phases.findIndex((phase) => phase.id === id);
  const previous = existingIndex >= 0 ? state.phases[existingIndex] : null;

  // Cached remounts must not rewind a finished step back to "Loading…".
  if (previous && TERMINAL_STATUSES.has(previous.status) && !TERMINAL_STATUSES.has(status)) {
    return state;
  }
  if (
    (state.overall === 'ready' || state.overall === 'degraded')
    && !TERMINAL_STATUSES.has(status)
  ) {
    return state;
  }

  let phases = closeOpenPhases(state.phases, id, at);
  const nextIndex = phases.findIndex((phase) => phase.id === id);
  const current = nextIndex >= 0 ? phases[nextIndex] : previous;
  const startedAt = current?.startedAt ?? at;
  const nextPhase = {
    id,
    label: label || current?.label || id,
    status,
    detail: detail || current?.detail || '',
    startedAt,
    endedAt: TERMINAL_STATUSES.has(status) ? at : null,
    durationMs: TERMINAL_STATUSES.has(status) ? Math.max(0, at - startedAt) : null,
  };
  if (nextIndex >= 0) {
    phases = phases.map((phase, index) => (index === nextIndex ? nextPhase : phase));
  } else {
    phases = [...phases, nextPhase];
  }

  const overall = status === 'error'
    ? 'failed'
    : state.overall === 'failed'
      ? 'failed'
      : state.overall === 'ready'
        ? 'ready'
        : 'booting';

  return {
    ...state,
    overall,
    currentPhaseId: TERMINAL_STATUSES.has(status) ? (id === state.currentPhaseId ? null : state.currentPhaseId) : id,
    phases,
    events: pushEvent(state.events, {
      at,
      kind: status,
      text: nextPhase.detail ? `${nextPhase.label} — ${nextPhase.detail}` : nextPhase.label,
    }),
    runtime: { ...state.runtime, elapsedMs: Math.max(0, at - state.startedAt) },
  };
}

export function applyBootError(state, {
  message,
  detail = '',
  source = 'boot',
  at = 0,
} = {}) {
  const label = String(message || 'Unknown error').trim() || 'Unknown error';
  const errors = [...state.errors, { at, message: label, detail, source }];
  const currentId = state.currentPhaseId;
  const phases = currentId
    ? state.phases.map((phase) => (
      phase.id === currentId && !TERMINAL_STATUSES.has(phase.status)
        ? {
          ...phase,
          status: 'error',
          detail: label,
          endedAt: at,
          durationMs: Math.max(0, at - phase.startedAt),
        }
        : phase
    ))
    : state.phases;
  return {
    ...state,
    overall: 'failed',
    phases,
    errors,
    events: pushEvent(state.events, {
      at,
      kind: 'error',
      text: detail ? `${label} — ${detail}` : `${source}: ${label}`,
    }),
    runtime: { ...state.runtime, elapsedMs: Math.max(0, at - state.startedAt) },
  };
}

export function applyBootComplete(state, {
  at = 0,
  detail = '',
  degraded = false,
} = {}) {
  const phases = closeOpenPhases(state.phases, null, at, degraded ? 'warn' : 'ok');
  return {
    ...state,
    overall: state.overall === 'failed' ? 'failed' : (degraded ? 'degraded' : 'ready'),
    currentPhaseId: null,
    phases,
    events: pushEvent(state.events, {
      at,
      kind: degraded ? 'warn' : 'ok',
      text: detail || (degraded ? 'Globe up with warnings' : 'Globe ready'),
    }),
    runtime: { ...state.runtime, elapsedMs: Math.max(0, at - state.startedAt) },
  };
}

export function applyStallCheck(state, now = 0) {
  const elapsedMs = Math.max(0, now - state.startedAt);
  const current = state.phases.find((phase) => phase.id === state.currentPhaseId);
  if (!current || TERMINAL_STATUSES.has(current.status)) {
    return elapsedMs === state.runtime.elapsedMs
      ? state
      : { ...state, runtime: { ...state.runtime, elapsedMs } };
  }
  if (now - current.startedAt < BOOT_STALL_MS) {
    return { ...state, runtime: { ...state.runtime, elapsedMs } };
  }
  if (current.status === 'stall' && state.overall === 'stall') {
    return { ...state, runtime: { ...state.runtime, elapsedMs } };
  }
  const phases = state.phases.map((phase) => (
    phase.id === current.id ? { ...phase, status: 'stall' } : phase
  ));
  const hint = stallHintForPhase(current.id);
  const alreadyHinted = state.events.some((event) => event.kind === 'stall' && event.text === hint);
  return {
    ...state,
    overall: state.overall === 'failed' ? 'failed' : 'stall',
    phases,
    events: alreadyHinted
      ? state.events
      : pushEvent(state.events, { at: now, kind: 'stall', text: hint }),
    runtime: { ...state.runtime, elapsedMs },
  };
}

export function applyProbes(state, probes = {}) {
  return {
    ...state,
    probes: { ...state.probes, ...probes },
  };
}

export function applyRuntimeSample(state, sample = {}) {
  const layersError = Number(sample.layersError) || 0;
  let overall = state.overall;
  if (overall === 'ready' && layersError > 0) overall = 'degraded';
  if (overall === 'degraded' && layersError === 0 && state.errors.length === 0) overall = 'ready';
  return {
    ...state,
    overall,
    runtime: {
      ...state.runtime,
      layersEnabled: Number(sample.layersEnabled) || 0,
      layersLoading: Number(sample.layersLoading) || 0,
      layersError,
      mapStack: String(sample.mapStack || state.runtime.mapStack || ''),
      mapError: String(sample.mapError || ''),
    },
  };
}

function probeLine(probes) {
  const parts = [];
  if (probes.webgl) parts.push(probes.webgl.ok ? 'WebGL ok' : 'WebGL fail');
  if (probes.assets) parts.push(probes.assets.ok ? 'workers ok' : 'workers fail');
  if (probes.tileset) {
    parts.push(probes.tileset.ok
      ? (probes.tileset.detail || 'tiles ok')
      : (probes.tileset.detail || 'tiles fallback'));
  }
  if (probes.canvas) parts.push(probes.canvas.ok ? 'canvas' : 'no canvas');
  return parts.join(' · ');
}

export function presentBootDebug(state, now = 0) {
  const elapsedMs = Math.max(state.runtime.elapsedMs, now - state.startedAt);
  const current = state.phases.find((phase) => phase.id === state.currentPhaseId) || state.phases.at(-1) || null;
  const lastError = state.errors.at(-1) || null;
  const stalled = current?.status === 'stall' || state.overall === 'stall';
  const overall = state.overall;
  const overallLabel = {
    booting: 'BOOT',
    stall: 'STALL',
    ready: 'READY',
    degraded: 'DEGRADED',
    failed: 'ERROR',
  }[overall] || 'BOOT';

  let hint = '';
  if (lastError) {
    hint = lastError.detail ? `${lastError.message} — ${lastError.detail}` : lastError.message;
  } else if (stalled && current) {
    hint = stallHintForPhase(current.id);
  } else if (overall === 'degraded' && state.runtime.layersError) {
    hint = `${state.runtime.layersError} live-data layer${state.runtime.layersError === 1 ? '' : 's'} reporting an error`;
  } else if (overall === 'degraded' && state.runtime.mapError) {
    hint = state.runtime.mapError;
  } else if (overall === 'ready') {
    const stack = state.runtime.mapStack || state.probes.mapStack?.detail || 'globe';
    const layers = state.runtime.layersEnabled;
    hint = layers
      ? `${stack} · ${layers} layer${layers === 1 ? '' : 's'} on`
      : `${stack} · no live layers on`;
  } else if (current?.detail) {
    hint = current.detail;
  }

  let phaseLabel = current?.label || 'Starting globe';
  if (overall === 'ready') phaseLabel = 'Globe ready';
  else if (overall === 'degraded') phaseLabel = 'Globe up with warnings';
  else if (overall === 'failed') phaseLabel = lastError?.message || current?.label || 'Boot failed';

  return {
    overall,
    overallLabel,
    elapsedLabel: formatElapsed(elapsedMs),
    phaseLabel,
    phaseStatus: current?.status || (overall === 'ready' ? 'ok' : 'pending'),
    probesLabel: probeLine(state.probes),
    hint,
    autoExpand: overall === 'failed' || overall === 'stall',
    events: state.events,
    errors: state.errors,
    phases: state.phases,
  };
}

export function probeWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
      || canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { ok: false, detail: 'No WebGL context' };
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'WebGL')
      : (gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL');
    const lost = typeof gl.isContextLost === 'function' && gl.isContextLost();
    if (lost) return { ok: false, detail: 'WebGL context lost' };
    return { ok: true, detail: renderer };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

let cesiumAssetsProbe = null;

export async function probeCesiumAssets(baseUrl = '/cesium/') {
  if (cesiumAssetsProbe?.ok) return cesiumAssetsProbe;
  const base = String(baseUrl || '/cesium/').replace(/\/?$/, '/');
  const url = `${base}Workers/createGeometry.js`;
  try {
    const response = await fetch(url, { method: 'GET', cache: 'force-cache' });
    const result = response.ok
      ? { ok: true, detail: url }
      : { ok: false, detail: `${response.status} ${url}` };
    if (result.ok) cesiumAssetsProbe = result;
    return result;
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function yieldToPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

export function withTimeout(promise, ms, message) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([
    Promise.resolve(promise).finally(() => window.clearTimeout(timer)),
    timeout,
  ]);
}

function createSingleton() {
  return {
    state: null,
    root: null,
    timer: 0,
    unsub: null,
    trapsInstalled: false,
    expanded: false,
    autoOpened: false,
  };
}

const singleton = (typeof window !== 'undefined' && window.__gevBootDebugSingleton)
  ? window.__gevBootDebugSingleton
  : createSingleton();
if (typeof window !== 'undefined') window.__gevBootDebugSingleton = singleton;

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function ensureMarkup() {
  let root = document.getElementById('boot-debug-bar');
  if (root) {
    if (root.parentElement !== document.body) document.body.appendChild(root);
    return root;
  }
  root = document.createElement('aside');
  root.id = 'boot-debug-bar';
  root.className = 'boot-debug-bar';
  root.setAttribute('data-state', 'booting');
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = `
    <button type="button" id="boot-debug-toggle" class="boot-debug-toggle" aria-expanded="false" aria-controls="boot-debug-log">
      <span class="boot-debug-dot" aria-hidden="true"></span>
      <span id="boot-debug-overall">BOOT</span>
      <span id="boot-debug-elapsed">0.0s</span>
      <strong id="boot-debug-phase">Starting globe</strong>
      <span id="boot-debug-probes"></span>
      <span class="boot-debug-chevron material-symbols-outlined" aria-hidden="true">expand_less</span>
    </button>
    <p id="boot-debug-hint" class="boot-debug-hint">Waiting for the first boot step.</p>
    <div id="boot-debug-log" class="boot-debug-log" hidden>
      <ol id="boot-debug-events"></ol>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

function bindToggle(root) {
  const toggle = root.querySelector('#boot-debug-toggle');
  if (!toggle || toggle.dataset.bound === 'true') return;
  toggle.dataset.bound = 'true';
  toggle.addEventListener('click', () => {
    singleton.expanded = !singleton.expanded;
    paint();
  });
}

function paint() {
  if (typeof document === 'undefined' || !singleton.state) return;
  const root = singleton.root || document.getElementById('boot-debug-bar');
  if (!root) return;
  singleton.root = root;
  const view = presentBootDebug(singleton.state, nowMs());
  if (view.autoExpand && !singleton.autoOpened) {
    singleton.expanded = true;
    singleton.autoOpened = true;
  }
  const expanded = singleton.expanded;
  root.dataset.state = view.overall;
  root.classList.toggle('expanded', expanded);
  document.body.classList.add('boot-debug-visible');
  document.body.style.setProperty('--boot-debug-height', '56px');

  const overall = root.querySelector('#boot-debug-overall');
  const elapsed = root.querySelector('#boot-debug-elapsed');
  const phase = root.querySelector('#boot-debug-phase');
  const probes = root.querySelector('#boot-debug-probes');
  const hint = root.querySelector('#boot-debug-hint');
  const log = root.querySelector('#boot-debug-log');
  const list = root.querySelector('#boot-debug-events');
  const toggle = root.querySelector('#boot-debug-toggle');
  const chevron = root.querySelector('.boot-debug-chevron');

  if (overall) overall.textContent = view.overallLabel;
  if (elapsed) elapsed.textContent = view.elapsedLabel;
  if (phase) phase.textContent = view.phaseLabel;
  if (probes) probes.textContent = view.probesLabel;
  if (hint) hint.textContent = view.hint || '';
  if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  if (chevron) chevron.textContent = expanded ? 'expand_more' : 'expand_less';
  if (log) log.hidden = !expanded;
  if (list) {
    list.replaceChildren(...view.events.slice(-16).reverse().map((event) => {
      const item = document.createElement('li');
      item.dataset.kind = event.kind;
      const stamp = document.createElement('span');
      stamp.textContent = formatElapsed(event.at - singleton.state.startedAt);
      const text = document.createElement('span');
      text.textContent = event.text;
      item.append(stamp, text);
      return item;
    }));
  }
}

function tick() {
  if (!singleton.state) return;
  singleton.state = applyStallCheck(singleton.state, nowMs());
  paint();
}

function installErrorTraps() {
  if (singleton.trapsInstalled || typeof window === 'undefined') return;
  singleton.trapsInstalled = true;
  window.addEventListener('error', (event) => {
    const message = event?.message || event?.error?.message || 'Script error';
    if (/ResizeObserver|Hydration failed|Minified React error/i.test(String(message))) return;
    reportBootError(message, { source: event?.filename || 'window' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const message = reason instanceof Error ? reason.message : String(reason || 'Unhandled rejection');
    reportBootError(message, { source: 'promise' });
  });
}

export function mountBootDebugBar(_host) {
  if (!singleton.state) singleton.state = createBootDebugState(nowMs());
  if (typeof document === 'undefined') return null;
  const root = ensureMarkup();
  singleton.root = root;
  bindToggle(root);
  installErrorTraps();
  if (!singleton.timer) singleton.timer = window.setInterval(tick, 250);
  document.body.classList.add('boot-debug-visible');
  paint();
  window.__gevBootDebug = {
    getState: () => singleton.state,
    present: () => presentBootDebug(singleton.state, nowMs()),
  };
  return root;
}

export function reportBootPhase(id, label, detailOrOptions = '') {
  mountBootDebugBar();
  const options = typeof detailOrOptions === 'string'
    ? { detail: detailOrOptions }
    : (detailOrOptions || {});
  singleton.state = applyBootPhase(singleton.state, {
    id,
    label,
    status: options.status || 'pending',
    detail: options.detail || '',
    at: nowMs(),
  });
  if (options.probe) {
    singleton.state = applyProbes(singleton.state, options.probe);
  }
  paint();
}

export function completeBootPhase(id, { status = 'ok', detail = '', probe } = {}) {
  mountBootDebugBar();
  singleton.state = applyBootPhase(singleton.state, {
    id,
    status,
    detail,
    at: nowMs(),
  });
  if (probe) singleton.state = applyProbes(singleton.state, probe);
  paint();
}

export function reportBootError(message, { detail = '', source = 'boot' } = {}) {
  mountBootDebugBar();
  singleton.state = applyBootError(singleton.state, {
    message,
    detail,
    source,
    at: nowMs(),
  });
  singleton.expanded = true;
  paint();
}

export function reportBootProbes(probes) {
  mountBootDebugBar();
  singleton.state = applyProbes(singleton.state, probes);
  paint();
}

export function completeBoot({ detail = '', degraded = false } = {}) {
  mountBootDebugBar();
  singleton.state = applyBootComplete(singleton.state, {
    at: nowMs(),
    detail,
    degraded,
  });
  paint();
}

export function attachBootRuntime({ dataManager, mapStackController, viewer } = {}) {
  mountBootDebugBar();
  if (singleton.unsub) {
    singleton.unsub();
    singleton.unsub = null;
  }

  const sample = () => {
    const layers = dataManager?.getAll?.() || [];
    const enabled = layers.filter((layer) => layer.enabled);
    const loading = enabled.filter((layer) => (
      layer.lifecycleState === 'enabling'
      || layer.stats?.loading === true
      || layer.stats?.refreshing === true
    ));
    const errored = enabled.filter((layer) => (
      layer.stats?.error
      || layer.stats?.unavailable === true
      || layer.stats?.keyRequired === true
    ));
    const mapState = mapStackController?.getState?.();
    const canvas = viewer?.scene?.canvas || document.querySelector('#cesiumContainer canvas');
    singleton.state = applyRuntimeSample(singleton.state, {
      layersEnabled: enabled.length,
      layersLoading: loading.length,
      layersError: errored.length,
      mapStack: mapState?.activeStack?.label || mapState?.activeId || '',
      mapError: mapState?.lastError || '',
    });
    singleton.state = applyProbes(singleton.state, {
      canvas: { ok: Boolean(canvas), detail: canvas ? 'canvas' : 'no canvas' },
      mapStack: {
        ok: !mapState?.lastError,
        detail: mapState?.activeStack?.shortLabel || mapState?.activeId || '',
      },
    });
    paint();
  };

  sample();
  const unsubManager = typeof dataManager?.subscribe === 'function'
    ? dataManager.subscribe(sample)
    : null;
  singleton.unsub = () => {
    unsubManager?.();
  };
}

export function getBootDebugState() {
  return singleton.state;
}

if (import.meta.hot) import.meta.hot.accept();
