import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBootComplete,
  applyBootError,
  applyBootPhase,
  applyRuntimeSample,
  applyStallCheck,
  BOOT_STALL_MS,
  createBootDebugState,
  formatElapsed,
  presentBootDebug,
  stallHintForPhase,
} from './bootDebugBar.js';

test('formatElapsed uses tenths under 10s and whole seconds after', () => {
  assert.equal(formatElapsed(0), '0.0s');
  assert.equal(formatElapsed(4100), '4.1s');
  assert.equal(formatElapsed(10400), '10s');
});

test('a new phase auto-completes the previous pending step', () => {
  let state = createBootDebugState(0);
  state = applyBootPhase(state, { id: 'engine', label: 'Loading globe engine', at: 10 });
  state = applyBootPhase(state, { id: 'viewer', label: 'Creating Cesium viewer', at: 2500 });
  assert.equal(state.phases[0].status, 'ok');
  assert.equal(state.phases[0].durationMs, 2490);
  assert.equal(state.currentPhaseId, 'viewer');
  assert.equal(state.overall, 'booting');
});

test('stall check marks a phase after the threshold and exposes a hint', () => {
  let state = createBootDebugState(0);
  state = applyBootPhase(state, { id: 'viewer', label: 'Creating Cesium viewer', at: 100 });
  state = applyStallCheck(state, 100 + BOOT_STALL_MS);
  assert.equal(state.overall, 'stall');
  assert.equal(state.phases[0].status, 'stall');
  const view = presentBootDebug(state, 100 + BOOT_STALL_MS);
  assert.equal(view.overallLabel, 'STALL');
  assert.equal(view.autoExpand, true);
  assert.match(view.hint, /WebGL|worker|shader/i);
  assert.equal(view.hint, stallHintForPhase('viewer'));
});

test('a later success clears stall once the phase completes', () => {
  let state = createBootDebugState(0);
  state = applyBootPhase(state, { id: 'viewer', label: 'Creating Cesium viewer', at: 0 });
  state = applyStallCheck(state, BOOT_STALL_MS);
  state = applyBootPhase(state, { id: 'viewer', status: 'ok', detail: 'Viewer ready', at: BOOT_STALL_MS + 500 });
  state = applyBootComplete(state, { at: BOOT_STALL_MS + 800, detail: 'Keyless globe ready' });
  assert.equal(state.overall, 'ready');
  const view = presentBootDebug(state, BOOT_STALL_MS + 800);
  assert.equal(view.overallLabel, 'READY');
  assert.match(view.hint, /globe/i);
});

test('errors fail the bar and become the visible hint', () => {
  let state = createBootDebugState(0);
  state = applyBootPhase(state, { id: 'webgl', label: 'Checking WebGL', at: 20 });
  state = applyBootError(state, { message: 'No WebGL context', source: 'probe', at: 40 });
  assert.equal(state.overall, 'failed');
  assert.equal(state.phases[0].status, 'error');
  const view = presentBootDebug(state, 40);
  assert.equal(view.overallLabel, 'ERROR');
  assert.equal(view.hint, 'No WebGL context');
  assert.equal(view.autoExpand, true);
});

test('layer errors after ready present as degraded, not a silent ready state', () => {
  let state = createBootDebugState(0);
  state = applyBootComplete(state, { at: 1000, detail: 'Globe ready' });
  state = applyRuntimeSample(state, { layersEnabled: 2, layersLoading: 0, layersError: 1, mapStack: 'Esri Satellite' });
  const view = presentBootDebug(state, 1200);
  assert.equal(view.overallLabel, 'DEGRADED');
  assert.match(view.hint, /1 live-data layer/);
});

test('a completed phase is not rewound to pending after modules are cached', () => {
  let state = createBootDebugState(0);
  state = applyBootPhase(state, { id: 'engine', label: 'Loading globe engine', at: 10 });
  state = applyBootPhase(state, { id: 'engine', status: 'ok', detail: 'Globe engine cached in memory', at: 80 });
  state = applyBootPhase(state, { id: 'webgl', label: 'Checking WebGL', at: 90 });
  state = applyBootPhase(state, { id: 'engine', label: 'Loading globe engine', at: 120 });
  const engine = state.phases.find((phase) => phase.id === 'engine');
  assert.equal(engine.status, 'ok');
  assert.equal(state.currentPhaseId, 'webgl');
});

test('ready boot ignores a later pending engine report', () => {
  let state = createBootDebugState(0);
  state = applyBootPhase(state, { id: 'engine', label: 'Loading globe engine', at: 0 });
  state = applyBootComplete(state, { at: 500, detail: 'Globe ready' });
  state = applyBootPhase(state, { id: 'engine', label: 'Loading globe engine', at: 600 });
  assert.equal(state.overall, 'ready');
  assert.equal(state.currentPhaseId, null);
});
