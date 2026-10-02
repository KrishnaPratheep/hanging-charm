/**
 * Headless tests for the charm physics and its pointer-drag interaction.
 *
 * These run the real Matter.js scene (bundled from src/renderer/physics) in
 * Node — no DOM, no Pixi, no Electron. Run with `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCharmScene } = require('../.vite/test/scene.cjs');

const FIXED_STEP_MS = 1000 / 60;
const WIDTH = 420;
const HEIGHT = 320;

const makeScene = (overrides = {}) => createCharmScene(WIDTH, HEIGHT, overrides);

const stepMany = (scene, steps) => {
  for (let i = 0; i < steps; i += 1) {
    scene.step(FIXED_STEP_MS);
  }
};

/** Charm center as rendered (interpolated at alpha 1 = current pose). */
const charmPoint = (scene) => {
  const { points } = scene.sample(1);
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
};

const pointsFinite = (scene) =>
  scene.sample(1).points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const grabCharm = (scene) => scene.beginDrag(charmPoint(scene));

test('baseline: swing settles at rest, rope taut, no NaN', () => {
  const scene = makeScene();
  stepMany(scene, 60 * 14);

  const diagnostics = scene.diagnostics();
  assert.ok(pointsFinite(scene), 'positions must stay finite');
  assert.ok(
    diagnostics.charmDistanceFromAnchor <= diagnostics.restDistance * 1.06,
    `rope stretched to ${diagnostics.charmDistanceFromAnchor.toFixed(1)}px of ${diagnostics.restDistance.toFixed(1)}px`,
  );
  assert.ok(
    Math.abs(diagnostics.charmDistanceFromAnchor - diagnostics.restDistance) <=
      diagnostics.restDistance * 0.03,
    'charm should hang at its rest length',
  );
  assert.equal(diagnostics.isDragging, false);
  assert.equal(diagnostics.constraintCount, scene.ropeConstraintCount);
});

test('anchor stays fixed and rope constraints stay intact while swinging', () => {
  const scene = makeScene();
  const anchor = { ...scene.anchorPoint };
  const ropeCount = scene.ropeConstraintCount;

  stepMany(scene, 60 * 5);

  const { points } = scene.sample(1);
  assert.deepEqual({ x: points[0].x, y: points[0].y }, anchor);
  assert.equal(scene.diagnostics().constraintCount, ropeCount);
});

test('drag lifecycle: grab state starts, charm follows, release restores the rope', () => {
  const scene = makeScene();
  stepMany(scene, 30);

  assert.equal(scene.isDragging(), false);
  assert.equal(scene.beginDrag({ x: Number.NaN, y: 10 }), false, 'NaN grab point is refused');

  // Grab the charm slightly off-centre, like a real pointer would.
  const grab = charmPoint(scene);
  assert.equal(scene.beginDrag({ x: grab.x + 14, y: grab.y - 10 }), true);
  assert.equal(scene.isDragging(), true);
  assert.equal(scene.diagnostics().constraintCount, scene.ropeConstraintCount + 1);
  assert.equal(scene.beginDrag(grab), false, 'a second grab while dragging is refused');

  const target = { x: 70, y: 110 };
  scene.moveDrag(target);
  const lagAtStart = distance(charmPoint(scene), target);
  stepMany(scene, 120);
  const lagAfterFollowing = distance(charmPoint(scene), target);

  assert.ok(
    lagAfterFollowing < lagAtStart * 0.5,
    `charm should move toward the pointer (lag ${lagAtStart.toFixed(1)} -> ${lagAfterFollowing.toFixed(1)}px)`,
  );
  assert.ok(
    lagAfterFollowing < 30,
    `charm should follow closely, lag was ${lagAfterFollowing.toFixed(1)}px`,
  );

  const during = scene.diagnostics();
  assert.ok(pointsFinite(scene));
  assert.ok(
    during.maxLinkStretch <= 1.12,
    `rope links stretched to ${(during.maxLinkStretch * 100).toFixed(1)}% while dragged`,
  );
  assert.ok(
    during.charmDistanceFromAnchor <= during.restDistance * 1.1,
    'dragging must not pull the charm past the rope reach',
  );

  // Release while the charm is actually moving: removing the drag constraint
  // must hand a real velocity back to gravity and the rope.
  scene.moveDrag({ x: 310, y: 150 });
  let speedBeforeRelease = 0;
  for (let i = 0; i < 40 && speedBeforeRelease <= 0.5; i += 1) {
    scene.step(FIXED_STEP_MS);
    speedBeforeRelease = scene.diagnostics().charmSpeed;
  }
  assert.equal(scene.endDrag(), true);
  assert.equal(scene.diagnostics().isDragging, false);
  assert.equal(scene.diagnostics().constraintCount, scene.ropeConstraintCount);
  assert.ok(speedBeforeRelease > 0.2, `expected motion at release, got ${speedBeforeRelease}`);
  assert.equal(
    scene.diagnostics().charmSpeed,
    speedBeforeRelease,
    'release must preserve momentum',
  );
  assert.equal(scene.endDrag(), false, 'releasing twice is a no-op');
});

test('grab preserves the charm position and velocity', () => {
  const scene = makeScene();
  stepMany(scene, 40);

  const positionBefore = charmPoint(scene);
  const velocityBefore = scene.diagnostics().charmSpeed;

  assert.equal(grabCharm(scene), true);

  assert.deepEqual(charmPoint(scene), positionBefore);
  assert.equal(scene.diagnostics().charmSpeed, velocityBefore);
  scene.endDrag();
});

test('release hands the charm back to gravity and the rope', () => {
  const scene = makeScene();
  const ropeCount = scene.ropeConstraintCount;

  grabCharm(scene);
  scene.moveDrag({ x: 90, y: 100 });
  stepMany(scene, 60);
  scene.endDrag();

  stepMany(scene, 60 * 20);

  const settled = scene.diagnostics();
  assert.ok(pointsFinite(scene));
  assert.equal(settled.isDragging, false);
  assert.equal(settled.constraintCount, ropeCount, 'drag constraint must be removed');
  assert.ok(
    Math.abs(settled.charmDistanceFromAnchor - settled.restDistance) <=
      settled.restDistance * 0.03,
    `charm should settle hanging again, at ${settled.charmDistanceFromAnchor.toFixed(1)}px`,
  );
  assert.ok(settled.charmSpeed < 0.05, `charm should come to rest, speed ${settled.charmSpeed}`);
});

test('fast, teleporting, out-of-bounds drags stay finite and speed-capped', () => {
  const scene = makeScene();
  const ropeCount = scene.ropeConstraintCount;
  const extremes = [
    { x: -500, y: -500 },
    { x: WIDTH + 500, y: -200 },
    { x: WIDTH + 500, y: HEIGHT + 400 },
    { x: -500, y: HEIGHT + 400 },
    { x: WIDTH / 2, y: -400 },
    { x: WIDTH / 2, y: 500 },
  ];

  let maxSpeed = 0;
  for (let round = 0; round < 15; round += 1) {
    grabCharm(scene);
    for (const target of extremes) {
      scene.moveDrag(target); // teleport the pointer: worst case per step
      for (let i = 0; i < 3; i += 1) {
        scene.step(FIXED_STEP_MS);
        const diagnostics = scene.diagnostics();
        maxSpeed = Math.max(maxSpeed, diagnostics.charmSpeed);
        assert.ok(pointsFinite(scene), 'positions must stay finite during fast drags');
        assert.ok(Number.isFinite(diagnostics.maxLinkStretch));
        assert.ok(
          diagnostics.charmDistanceFromAnchor <= diagnostics.restDistance * 1.1,
          `rope over-stretched to ${diagnostics.charmDistanceFromAnchor.toFixed(1)}px ` +
            `of ${diagnostics.restDistance.toFixed(1)}px`,
        );
      }
    }
    scene.endDrag();
    assert.equal(scene.diagnostics().constraintCount, ropeCount);
    stepMany(scene, 5);
  }

  assert.ok(
    maxSpeed <= scene.config.dragMaxSpeed + 1e-6,
    `speed safety cap breached: ${maxSpeed.toFixed(2)} > ${scene.config.dragMaxSpeed}`,
  );
});

test('a pointer teleport never yanks the charm beyond the chase speed', () => {
  const scene = makeScene();
  stepMany(scene, 60);
  grabCharm(scene);

  const before = charmPoint(scene);
  scene.moveDrag({ x: WIDTH + 500, y: HEIGHT + 500 }); // far corner, projected to rope reach
  scene.step(FIXED_STEP_MS);
  const jumped = distance(before, charmPoint(scene));
  const allowed = scene.config.dragFollowSpeed * FIXED_STEP_MS + 10;
  assert.ok(jumped <= allowed, `charm moved ${jumped.toFixed(1)}px in one step (max ${allowed.toFixed(1)}px)`);

  const dragging = scene.diagnostics();
  assert.ok(
    dragging.charmDistanceFromAnchor <= dragging.restDistance * 1.06,
    `rope stretched to ${dragging.charmDistanceFromAnchor.toFixed(1)}px of ${dragging.restDistance.toFixed(1)}px`,
  );
  scene.endDrag();
});

test('dragging close to the top edge and above the anchor stays stable', () => {
  const scene = makeScene();
  grabCharm(scene);
  scene.moveDrag({ x: scene.anchorPoint.x, y: -30 });
  stepMany(scene, 120);

  assert.ok(pointsFinite(scene));
  const dragging = scene.diagnostics();
  assert.ok(dragging.maxLinkStretch <= 1.15, `stretch ${dragging.maxLinkStretch}`);

  scene.endDrag();
  stepMany(scene, 60 * 20);

  const settled = scene.diagnostics();
  assert.ok(pointsFinite(scene));
  assert.ok(settled.charmDistanceFromAnchor <= settled.restDistance * 1.06);
});

test('clicks without dragging and repeated grab/release cycles stay stable', () => {
  const scene = makeScene();
  const ropeCount = scene.ropeConstraintCount;

  for (let i = 0; i < 120; i += 1) {
    assert.equal(grabCharm(scene), true, `grab ${i} should start`);

    if (i % 3 === 0) {
      scene.moveDrag({ x: 100 + (i % 60), y: 110 + (i % 40) });
      stepMany(scene, 2);
    } else if (i % 3 === 1) {
      stepMany(scene, 1);
    }
    // i % 3 === 2: click without dragging at all.

    scene.endDrag();
    assert.equal(scene.diagnostics().constraintCount, ropeCount, `cycle ${i} leaked a constraint`);
    assert.ok(pointsFinite(scene), `cycle ${i} produced non-finite positions`);
  }

  stepMany(scene, 60 * 20);
  const settled = scene.diagnostics();
  assert.equal(settled.isDragging, false);
  assert.equal(settled.constraintCount, ropeCount);
  assert.ok(
    Math.abs(settled.charmDistanceFromAnchor - settled.restDistance) <=
      settled.restDistance * 0.05,
    `charm should return to hanging, at ${settled.charmDistanceFromAnchor.toFixed(1)}px`,
  );
});

test('dragging the charm inward and releasing recovers to a normal hang', () => {
  const scene = makeScene();
  const ropeCount = scene.ropeConstraintCount;
  stepMany(scene, 60 * 6);

  grabCharm(scene);
  // Well inside the rope reach: the chain has to fold, like slack rope.
  scene.moveDrag({ x: scene.anchorPoint.x, y: scene.anchorPoint.y + 70 });
  stepMany(scene, 120);

  const inward = scene.diagnostics();
  assert.ok(pointsFinite(scene));
  assert.ok(
    inward.charmDistanceFromAnchor < inward.restDistance * 0.8,
    `charm should be pulled inward (at ${inward.charmDistanceFromAnchor.toFixed(1)}px of ` +
      `${inward.restDistance.toFixed(1)}px)`,
  );
  assert.ok(inward.maxLinkStretch <= 1.15, `link stretch ${inward.maxLinkStretch}`);

  scene.endDrag();
  stepMany(scene, 60 * 25);

  const settled = scene.diagnostics();
  assert.ok(pointsFinite(scene));
  assert.equal(settled.constraintCount, ropeCount);
  assert.ok(
    Math.abs(settled.charmDistanceFromAnchor - settled.restDistance) <=
      settled.restDistance * 0.03,
    `charm should hang again, at ${settled.charmDistanceFromAnchor.toFixed(1)}px`,
  );
  assert.ok(settled.charmSpeed < 0.05, `charm should come to rest, speed ${settled.charmSpeed}`);
});

test('releasing far outside the window still hands control back cleanly', () => {
  const scene = makeScene();
  const ropeCount = scene.ropeConstraintCount;

  grabCharm(scene);
  scene.moveDrag({ x: WIDTH + 400, y: -300 });
  stepMany(scene, 45);

  assert.equal(scene.endDrag(), true);
  assert.equal(scene.diagnostics().isDragging, false);
  assert.equal(scene.diagnostics().constraintCount, ropeCount);

  stepMany(scene, 60 * 20);
  const settled = scene.diagnostics();
  assert.ok(pointsFinite(scene));
  assert.ok(settled.charmDistanceFromAnchor <= settled.restDistance * 1.06);
  assert.ok(settled.charmSpeed < 0.05);
});

test('rope rest lengths and anchor are untouched by a drag session', () => {
  const scene = makeScene();
  const anchor = { ...scene.anchorPoint };
  const restBefore = scene.diagnostics().restDistance;

  grabCharm(scene);
  scene.moveDrag({ x: 40, y: 250 });
  stepMany(scene, 90);
  scene.endDrag();
  stepMany(scene, 60 * 12);

  assert.deepEqual(scene.anchorPoint, anchor);
  assert.equal(scene.diagnostics().restDistance, restBefore);
  assert.equal(scene.diagnostics().constraintCount, scene.ropeConstraintCount);

  const { points } = scene.sample(1);
  assert.deepEqual({ x: points[0].x, y: points[0].y }, anchor);
});
