/**
 * Physics tuning for the hanging charm.
 *
 * Units are Matter.js world units: pixels and milliseconds. All values can be
 * overridden per scene (see `createCharmScene(width, overrides)`), so
 * this object is the single source of truth for "how the charm feels".
 */
export interface CharmPhysicsConfig {
  /** Gravity components fed to `engine.gravity` (Matter's default scale is 0.001). */
  gravityX: number;
  gravityY: number;
  gravityScale: number;
  /** Total rest length of the rope in pixels (anchor to charm attachment point). */
  ropeLength: number;
  /** Target length of one rope link; the real link length is `ropeLength / round(ropeLength / segmentLength)`. */
  segmentLength: number;
  /** Physics radius of a rope link body (collisions are disabled, this only affects mass). */
  ropeBodyRadius: number;
  /** Per-link air drag — robs energy from rope wiggles. */
  segmentFrictionAir: number;
  /** Radius of the charm circle. */
  charmRadius: number;
  /** Charm density (mass = area * density). Heavier charms swing more authoritatively. */
  charmDensity: number;
  /** Charm air drag — the main knob for how quickly the swing dies out (~10s to visibly settle). */
  charmFrictionAir: number;
  /** Bounciness of the charm (0 = dead, 1 = perfectly elastic). */
  charmRestitution: number;
  /** Rope constraint stiffness (1 = rigid, < 1 = springy). */
  constraintStiffness: number;
  /** Rope constraint damping — removes energy from the swing. */
  constraintDamping: number;
  /** Solver iterations; more iterations = less rope stretch under load. */
  positionIterations: number;
  velocityIterations: number;
  constraintIterations: number;
  /** Anchor position: horizontal fraction of the window width, and pixels from the top. */
  anchorXRatio: number;
  anchorY: number;
  /** Initial rope angle from vertical, in radians — lets the charm start swinging. */
  initialSwingAngle: number;
  /** Stiffness of the temporary drag constraint (higher = tighter pointer follow). */
  dragStiffness: number;
  /** Damping of the drag constraint — stops the charm wobbling while it is dragged. */
  dragDamping: number;
  /**
   * Angular stiffness of the drag constraint. 1 means the drag applies no
   * torque (the charm translates only), matching Matter's own MouseConstraint.
   */
  dragAngularStiffness: number;
  /** How far past the overlay edges the drag target may go before it is clamped. */
  dragBoundsMargin: number;
  /**
   * How fast the drag target may chase the pointer, in px per millisecond. The
   * pointer can teleport (a fast flick moves hundreds of px between frames);
   * bounding the chase keeps the drag force small enough for the rope to win.
   */
  dragFollowSpeed: number;
  /** Safety cap on charm speed while dragging, in px per 60 Hz physics step. */
  dragMaxSpeed: number;
  /** Fixed physics timestep in ms (1000/60 ≈ 60 Hz). */
  fixedTimestepMs: number;
  /** Longest real frame delta the loop will simulate before clamping (prevents spiral of death). */
  maxFrameDeltaMs: number;
  /** Maximum physics steps consumed per rendered frame. */
  maxSubSteps: number;
}

export const charmPhysicsConfig = {
  // Gravity: Matter's default acceleration is 1 (scale 0.001).
  gravityX: 0,
  gravityY: 1,
  gravityScale: 0.001,

  // Rope: 156px of rope as 8 links of 19.5px. Fewer, longer links stretch less
  // (each constraint contributes a little error), while the renderer still
  // gets enough points to draw a smooth curve.
  ropeLength: 156,
  segmentLength: 20,
  ropeBodyRadius: 4,
  segmentFrictionAir: 0.02,

  // Charm: a 26px ball roughly 5x the rope's total mass. The solver stretches
  // less under a lighter load, so the charm stays close to the rest length.
  charmRadius: 26,
  charmDensity: 0.0012,
  charmFrictionAir: 0.016,
  charmRestitution: 0.15,

  // Rope links: rigid (stiffness 1) but with a little damping so the swing
  // settles instead of ringing forever.
  constraintStiffness: 1,
  constraintDamping: 0.02,

  // Solver: extra constraint iterations keep the rope taut under the charm's
  // weight (Matter solves constraints sequentially).
  positionIterations: 8,
  velocityIterations: 6,
  constraintIterations: 12,

  // Anchor near the top center of the overlay.
  anchorXRatio: 0.5,
  anchorY: 22,

  // Start the rope ~31 degrees off vertical so the charm swings on launch.
  initialSwingAngle: 0.55,

  // Dragging: a temporary constraint pulls the charm toward the pointer. It is
  // deliberately softer than the rope so the rope always wins on reach.
  dragStiffness: 0.35,
  dragDamping: 0.1,
  dragAngularStiffness: 1,
  dragBoundsMargin: 60,
  dragFollowSpeed: 1.5,
  dragMaxSpeed: 36,

  // Loop: one 60 Hz physics step per tick, rendered with interpolation.
  fixedTimestepMs: 1000 / 60,
  maxFrameDeltaMs: 50,
  maxSubSteps: 4,
} satisfies CharmPhysicsConfig;
