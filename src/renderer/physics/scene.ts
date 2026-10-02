import Matter from 'matter-js';
import { charmPhysicsConfig, type CharmPhysicsConfig } from './config';

export interface Point {
  x: number;
  y: number;
}

/** One render frame's worth of positions (already interpolated). */
export interface CharmSample {
  /** Anchor, rope link centers, then charm center — the order is fixed. */
  points: Point[];
  /** Charm rotation in radians. */
  charmAngle: number;
}

export interface CharmDiagnostics {
  /** Current anchor-to-charm distance in pixels. */
  charmDistanceFromAnchor: number;
  /** Anchor-to-charm distance when the rope is at rest. */
  restDistance: number;
  /** Largest current link distance / rest length (1 = slack, > 1 = stretched). */
  maxLinkStretch: number;
  /** Charm speed in pixels per physics step. */
  charmSpeed: number;
  /** True while a pointer drag is pulling the charm. */
  isDragging: boolean;
  /** Constraints currently in the world: rope links plus any drag constraint. */
  constraintCount: number;
}

export interface CharmScene {
  readonly config: CharmPhysicsConfig;
  readonly anchorPoint: Point;
  readonly restDistance: number;
  /** Number of permanent rope constraints (anchor + links + charm attachment). */
  readonly ropeConstraintCount: number;
  /** Advances the simulation by one fixed timestep and saves the previous pose for interpolation. */
  step(deltaMs: number): void;
  /** Interpolates between the previous and current pose (`alpha` in [0, 1]). */
  sample(alpha: number): CharmSample;
  diagnostics(): CharmDiagnostics;
  /**
   * Starts dragging the charm toward `worldPoint` using a temporary constraint
   * (the same technique as Matter's own MouseConstraint). Returns false when a
   * drag is already running or the point is not finite. The charm's current
   * position and velocity are preserved.
   */
  beginDrag(worldPoint: Point): boolean;
  /** Moves the drag target; the solver pulls the charm toward it. No-op when not dragging. */
  moveDrag(worldPoint: Point): void;
  /** Removes the drag constraint and hands the charm back to gravity/rope. */
  endDrag(): boolean;
  isDragging(): boolean;
  dispose(): void;
}

/**
 * Bodies in this group never collide with each other. The rope is a pure
 * constraint chain, so its links must not push each other (or the charm)
 * around — they only exist to be pulled by constraints and gravity.
 */
const NO_COLLISIONS = { group: -1 };

/**
 * Matter's `angularStiffness` constraint option is real (Matter's own
 * MouseConstraint uses it) but is missing from @types/matter-js.
 */
type DragConstraint = Matter.Constraint & { angularStiffness: number };

/**
 * Builds the physics world: a fixed anchor, a rope of small chained bodies,
 * and a charm body attached to the last link. Pure physics — no rendering,
 * no DOM — so it can run headless in tests.
 */
export function createCharmScene(
  width: number,
  height: number,
  overrides: Partial<CharmPhysicsConfig> = {},
): CharmScene {
  const config: CharmPhysicsConfig = { ...charmPhysicsConfig, ...overrides };
  const { Engine, Composite, Bodies, Constraint, Vector, Body } = Matter;

  const engine = Engine.create({
    positionIterations: config.positionIterations,
    velocityIterations: config.velocityIterations,
    constraintIterations: config.constraintIterations,
    gravity: { x: config.gravityX, y: config.gravityY, scale: config.gravityScale },
  });

  // 1. Fixed anchor near the top of the window.
  const anchorPoint: Point = { x: width * config.anchorXRatio, y: config.anchorY };
  const anchor = Bodies.circle(anchorPoint.x, anchorPoint.y, 5, {
    isStatic: true,
    collisionFilter: NO_COLLISIONS,
  });

  // 2. Rope: a chain of small bodies joined by distance constraints. The rope
  //    is laid out along the initial swing angle so it starts stress-free.
  const linkCount = Math.max(3, Math.round(config.ropeLength / config.segmentLength));
  const linkLength = config.ropeLength / linkCount;
  const direction = {
    x: Math.sin(config.initialSwingAngle),
    y: Math.cos(config.initialSwingAngle),
  };

  const segments: Matter.Body[] = [];
  for (let i = 0; i < linkCount; i += 1) {
    const distance = (i + 1) * linkLength;
    segments.push(
      Bodies.circle(
        anchorPoint.x + direction.x * distance,
        anchorPoint.y + direction.y * distance,
        config.ropeBodyRadius,
        { frictionAir: config.segmentFrictionAir, collisionFilter: NO_COLLISIONS },
      ),
    );
  }

  // 3. Charm body attached to the bottom link. It starts one charm-radius
  //    below the last link, matching the rest length of the final constraint.
  const charmLinkLength = config.charmRadius + 2;
  const charmDistance = config.ropeLength + charmLinkLength;
  const charm = Bodies.circle(
    anchorPoint.x + direction.x * charmDistance,
    anchorPoint.y + direction.y * charmDistance,
    config.charmRadius,
    {
      density: config.charmDensity,
      frictionAir: config.charmFrictionAir,
      restitution: config.charmRestitution,
      collisionFilter: NO_COLLISIONS,
    },
  );

  const link = (
    bodyA: Matter.Body,
    bodyB: Matter.Body,
    length: number,
  ): Matter.Constraint =>
    Constraint.create({
      bodyA,
      bodyB,
      length,
      stiffness: config.constraintStiffness,
      damping: config.constraintDamping,
      render: { visible: false },
    });

  const constraints: Matter.Constraint[] = [
    link(anchor, segments[0], linkLength),
    ...segments.slice(1).map((segment, index) => link(segments[index], segment, linkLength)),
    link(segments[linkCount - 1], charm, charmLinkLength),
  ];

  Composite.add(engine.world, [anchor, ...segments, charm, ...constraints]);

  // Rendering order mirrors the visual rope: anchor -> links -> charm.
  const bodies: Matter.Body[] = [anchor, ...segments, charm];
  const previousPose: Point[] = bodies.map((body) => ({ ...body.position }));
  const sampledPose: Point[] = bodies.map(() => ({ x: 0, y: 0 }));
  const restDistance = config.ropeLength + charmLinkLength;

  // --- Pointer interaction ---------------------------------------------------
  // Dragging adds one temporary constraint whose world-space end (`pointA`)
  // follows the pointer while its body end (`pointB`) stays on the charm. The
  // solver moves the charm, so the rope keeps authority: it can never be
  // yanked past its rest length and the anchor is untouched. Removing the
  // constraint restores the exact original world.

  let dragConstraint: DragConstraint | null = null;
  /** Where the pointer currently is (already bounded and reach-projected). */
  const pointerTarget: Point = { x: anchorPoint.x, y: anchorPoint.y };
  /** Where the drag constraint actually pulls the charm — chases `pointerTarget`. */
  const dragPoint: Point = { x: anchorPoint.x, y: anchorPoint.y };

  /**
   * Keeps the drag target inside the disc the rope can actually reach.
   * Without this, dragging the pointer past the rope's length would ask for an
   * impossible position and the drag force would stretch the rope instead.
   */
  const projectToReach = (point: Point): Point => {
    const offset = Vector.sub(point, anchorPoint);
    const length = Vector.magnitude(offset);
    if (length <= restDistance || length === 0) {
      return { x: point.x, y: point.y };
    }
    const clamped = Vector.mult(Vector.div(offset, length), restDistance);
    return { x: anchorPoint.x + clamped.x, y: anchorPoint.y + clamped.y };
  };

  const clampDragPoint = (point: Point): Point => {
    const margin = config.dragBoundsMargin;
    return projectToReach({
      x: Math.min(Math.max(point.x, -margin), width + margin),
      y: Math.min(Math.max(point.y, -margin), height + margin),
    });
  };

  const beginDrag = (worldPoint: Point): boolean => {
    if (
      dragConstraint ||
      !Number.isFinite(worldPoint.x) ||
      !Number.isFinite(worldPoint.y)
    ) {
      return false;
    }
    const grabPoint = clampDragPoint(worldPoint);
    pointerTarget.x = grabPoint.x;
    pointerTarget.y = grabPoint.y;
    dragPoint.x = grabPoint.x;
    dragPoint.y = grabPoint.y;
    // Where on the charm the pointer grabbed it, in body-local coordinates.
    const localOffset = Vector.rotate(Vector.sub(grabPoint, charm.position), -charm.angle);
    const constraint = Constraint.create({
      label: 'charm-drag',
      pointA: dragPoint, // Matter keeps this reference, so `dragPoint` IS the constraint end
      bodyB: charm,
      pointB: localOffset,
      length: 0.01,
      stiffness: config.dragStiffness,
      damping: config.dragDamping,
      render: { visible: false },
    }) as DragConstraint;
    constraint.angularStiffness = config.dragAngularStiffness;
    dragConstraint = constraint;
    Composite.add(engine.world, constraint);
    return true;
  };

  const moveDrag = (worldPoint: Point): void => {
    if (
      !dragConstraint ||
      !Number.isFinite(worldPoint.x) ||
      !Number.isFinite(worldPoint.y)
    ) {
      return;
    }
    const target = clampDragPoint(worldPoint);
    pointerTarget.x = target.x;
    pointerTarget.y = target.y;
  };

  /**
   * Moves the drag point toward the pointer at a bounded speed (per physics
   * step, so it is frame-rate independent). A pointer that teleports across the
   * window therefore becomes a fast-but-finite pull instead of an instant yank.
   */
  const updateDragPoint = (deltaMs: number): void => {
    if (!dragConstraint) {
      return;
    }
    const maxStep = config.dragFollowSpeed * deltaMs;
    const offset = Vector.sub(pointerTarget, dragPoint);
    const length = Vector.magnitude(offset);
    if (length <= maxStep || length === 0) {
      dragPoint.x = pointerTarget.x;
      dragPoint.y = pointerTarget.y;
      return;
    }
    const step = Vector.mult(Vector.div(offset, length), maxStep);
    dragPoint.x += step.x;
    dragPoint.y += step.y;
  };

  const endDrag = (): boolean => {
    if (!dragConstraint) {
      return false;
    }
    Composite.remove(engine.world, dragConstraint);
    dragConstraint = null;
    return true;
  };

  const isDragging = (): boolean => dragConstraint !== null;

  /** Safety valve: the drag may never inject explosive speeds into the sim. */
  const limitDragSpeed = (): void => {
    if (!dragConstraint) {
      return;
    }
    const speed = Vector.magnitude(charm.velocity);
    if (speed > config.dragMaxSpeed) {
      // `Body.setSpeed` keeps the current direction and rewrites positionPrev,
      // so the clamp survives the next integration step.
      Body.setSpeed(charm, config.dragMaxSpeed);
    }
  };

  const step = (deltaMs: number): void => {
    // Remember where everything was before this step; `sample(alpha)` blends
    // this pose with the fresh one so rendering stays smooth at any refresh rate.
    for (let i = 0; i < bodies.length; i += 1) {
      previousPose[i].x = bodies[i].position.x;
      previousPose[i].y = bodies[i].position.y;
    }
    updateDragPoint(deltaMs);
    Engine.update(engine, deltaMs);
    limitDragSpeed();
  };

  const sample = (alpha: number): CharmSample => {
    const t = Math.min(Math.max(alpha, 0), 1);
    for (let i = 0; i < bodies.length; i += 1) {
      const current = bodies[i].position;
      sampledPose[i].x = previousPose[i].x + (current.x - previousPose[i].x) * t;
      sampledPose[i].y = previousPose[i].y + (current.y - previousPose[i].y) * t;
    }
    return { points: sampledPose, charmAngle: charm.angle };
  };

  const diagnostics = (): CharmDiagnostics => {
    let maxLinkStretch = 0;
    for (const constraint of constraints) {
      if (!constraint.bodyA || !constraint.bodyB) {
        continue;
      }
      const distance = Vector.magnitude(
        Vector.sub(constraint.bodyB.position, constraint.bodyA.position),
      );
      const rest = constraint.length || 1;
      maxLinkStretch = Math.max(maxLinkStretch, distance / rest);
    }

    return {
      charmDistanceFromAnchor: Vector.magnitude(Vector.sub(charm.position, anchorPoint)),
      restDistance,
      maxLinkStretch,
      charmSpeed: Vector.magnitude(charm.velocity),
      isDragging: dragConstraint !== null,
      constraintCount: constraints.length + (dragConstraint ? 1 : 0),
    };
  };

  const dispose = (): void => {
    dragConstraint = null;
    Composite.clear(engine.world, false);
    Engine.clear(engine);
  };

  return {
    config,
    anchorPoint,
    restDistance,
    ropeConstraintCount: constraints.length,
    step,
    sample,
    diagnostics,
    beginDrag,
    moveDrag,
    endDrag,
    isDragging,
    dispose,
  };
}
