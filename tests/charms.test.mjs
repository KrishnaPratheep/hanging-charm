/**
 * Charm asset system tests: registry behavior, validation, and the
 * physics/visual separation invariant. Runs headless (no DOM, no Pixi).
 *
 * The registry is bundled from TypeScript with esbuild (same pipeline as the
 * physics tests), so `import ... from '*.png'` resolves to the bundled path.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { charmPhysicsConfig } = require('../.vite/test/config.cjs');
const registry = require('../.vite/test/registry.cjs');
const types = require('../.vite/test/types.cjs');

describe('charm asset registry', () => {
  it('returns the default asset', () => {
    const asset = registry.getDefaultCharmAsset();
    assert.equal(asset.id, registry.defaultCharmId);
    assert.equal(asset.id, 'star');
  });

  it('resolves every built-in asset by id', () => {
    for (const asset of registry.listCharmAssets()) {
      assert.equal(registry.getCharmAsset(asset.id).id, asset.id);
      assert.ok(registry.hasCharmAsset(asset.id));
    }
  });

  it('falls back to the default for unknown ids instead of throwing', () => {
    const fallback = registry.getCharmAsset('does-not-exist');
    assert.deepEqual(fallback, registry.getDefaultCharmAsset());
    assert.equal(registry.hasCharmAsset('does-not-exist'), false);
  });

  it('handles nullish ids safely', () => {
    for (const id of [undefined, null, '']) {
      assert.deepEqual(registry.getCharmAsset(id), registry.getDefaultCharmAsset());
    }
  });

  it('registers every built-in asset without validation problems', () => {
    assert.equal(registry.getCharmRegistrationProblems().size, 0);
  });
});

describe('charm asset validation', () => {
  const validAsset = {
    id: 'unit',
    name: 'Unit Test Charm',
    type: 'blob',
    source: 'data:image/png;base64,AAA',
    width: 64,
    height: 64,
    pivot: { x: 32, y: 32 },
    ropeAnchor: { x: 32, y: 8 },
    bodyDiameter: 40,
  };

  it('accepts a well-formed asset', () => {
    assert.deepEqual(types.validateCharmAsset(validAsset), []);
  });

  it('rejects remote sources, bad dimensions, and out-of-bounds pivots', () => {
    const problems = types.validateCharmAsset({
      ...validAsset,
      source: 'https://example.com/charm.png',
      width: -1,
      pivot: { x: 500, y: 32 },
      bodyDiameter: 0,
    });
    assert.ok(problems.some((p) => p.includes('source')));
    assert.ok(problems.some((p) => p.includes('width')));
    assert.ok(problems.some((p) => p.includes('pivot')));
    assert.ok(problems.some((p) => p.includes('bodyDiameter')));
  });
});

describe('physics / visual separation', () => {
  it('keeps the physics charm radius independent of texture dimensions', () => {
    const asset = registry.getDefaultCharmAsset();
    // Texture is 128px, physics body stays at its configured radius.
    assert.equal(asset.width, 128);
    assert.equal(asset.height, 128);
    assert.equal(charmPhysicsConfig.charmRadius, 26);
    assert.equal(charmPhysicsConfig.charmRadius * 2, 52);
  });

  it('maps the configured body diameter onto the physics circle', () => {
    const asset = registry.getDefaultCharmAsset();
    // The view computes: scale = physicsDiameter / asset.bodyDiameter.
    // This test pins the invariant the view relies on.
    const expectedScale = (charmPhysicsConfig.charmRadius * 2) / asset.bodyDiameter;
    assert.ok(Number.isFinite(expectedScale) && expectedScale > 0);
    // The star's solid body (46px) covers the 52px physics circle ~1.13x.
    assert.equal(asset.bodyDiameter, 46);
  });

  it('does not change physics config when a different asset is selected', () => {
    const before = JSON.stringify(charmPhysicsConfig);
    registry.getCharmAsset('star');
    registry.getCharmAsset('totally-unknown');
    registry.getDefaultCharmAsset();
    assert.equal(JSON.stringify(charmPhysicsConfig), before);
  });

  it('never lets a bad asset id alter the physics configuration', () => {
    const before = JSON.stringify(charmPhysicsConfig);
    registry.getCharmAsset(null);
    registry.getCharmAsset(undefined);
    registry.getCharmAsset('../etc/passwd');
    registry.getCharmAsset('data:image/svg+xml,<svg/>');
    assert.equal(JSON.stringify(charmPhysicsConfig), before);
  });
});
