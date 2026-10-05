import test from 'node:test';
import assert from 'node:assert/strict';
import { isGlobeLive, loadGlobeEngine, resetBootCache, startGlobeBoot } from './bootCache.js';

test('isGlobeLive requires a connected Cesium canvas', () => {
  assert.equal(isGlobeLive({}), false);
  assert.equal(isGlobeLive({ __godsEyeView: { viewer: { scene: { canvas: { isConnected: false } } } } }), false);
  assert.equal(isGlobeLive({ __godsEyeView: { viewer: { scene: { canvas: { isConnected: true } } } } }), true);
});

test('the globe engine importer runs once', async () => {
  resetBootCache();
  let loads = 0;
  const importer = async () => {
    loads += 1;
    return { init: async () => {} };
  };
  await loadGlobeEngine(importer);
  await loadGlobeEngine(importer);
  assert.equal(loads, 1);
});

test('startGlobeBoot only constructs the globe once even if React remounts', async () => {
  resetBootCache();
  let loads = 0;
  let inits = 0;
  const importer = async () => {
    loads += 1;
    return {
      init: async () => {
        inits += 1;
      },
    };
  };

  await Promise.all([
    startGlobeBoot({ loadMain: importer }),
    startGlobeBoot({ loadMain: importer }),
  ]);
  await startGlobeBoot({ loadMain: importer });

  assert.equal(loads, 1);
  assert.equal(inits, 1);
});

test('startGlobeBoot reuses a preloaded engine module', async () => {
  resetBootCache();
  let loads = 0;
  const importer = async () => {
    loads += 1;
    return { init: async () => {} };
  };
  await loadGlobeEngine(importer);
  await startGlobeBoot({ loadMain: importer });
  await startGlobeBoot({ loadMain: importer });
  assert.equal(loads, 1);
});
