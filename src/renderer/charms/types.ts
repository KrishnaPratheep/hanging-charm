/**
 * Visual charm assets — the data model for what the charm looks like.
 *
 * Assets are purely visual: the physics layer never sees them. A `CharmAsset`
 * describes an original, bundled texture plus the metadata the view needs to
 * center, rotate, and scale it onto the (unchanging) physics body.
 */

/** A point in texture space, in pixels. */
export interface CharmVec2 {
  readonly x: number;
  readonly y: number;
}

/** Shape family, reserved for future per-shape rendering behavior. */
export type CharmAssetType = 'star' | 'planet' | 'ghost' | 'blob';

/**
 * One visual charm.
 *
 * Texture dimensions are deliberately independent of the physics body: the
 * view scales the texture so that `bodyDiameter` texture pixels cover the
 * physics body's diameter (`charmPhysicsConfig.charmRadius * 2`). Artwork may
 * extend past the physical circle (star tips) without touching the physics.
 */
export interface CharmAsset {
  /** Stable lookup id, e.g. "star". */
  readonly id: string;
  /** Human-readable name for future UI. */
  readonly name: string;
  /** Shape family. */
  readonly type: CharmAssetType;
  /**
   * Texture URL. Always a bundled asset (a `data:` URI in production builds,
   * a same-origin URL in dev) — remote URLs are rejected by validation.
   */
  readonly source: string;
  /** Texture width in pixels. */
  readonly width: number;
  /** Texture height in pixels. */
  readonly height: number;
  /** Rotation/position center in texture coordinates (usually the center). */
  readonly pivot: CharmVec2;
  /** Where the rope attaches, in texture coordinates (metadata for overlays). */
  readonly ropeAnchor: CharmVec2;
  /**
   * The texture-space span that maps onto the physics body's diameter.
   * The star uses its inner (valley-to-valley) diameter so its tips may
   * overhang the physics circle.
   */
  readonly bodyDiameter: number;
}

const isFinitePositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

const within = (value: number, max: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= max;

/**
 * Validates an asset without throwing; returns a list of problems
 * (empty means valid). Used on registration and in tests.
 */
export function validateCharmAsset(asset: CharmAsset): string[] {
  const problems: string[] = [];
  if (!asset.id || !asset.id.trim()) {
    problems.push('id must be a non-empty string');
  }
  if (!asset.name || !asset.name.trim()) {
    problems.push('name must be a non-empty string');
  }
  if (!/^(data:|blob:|\.?\/)/.test(asset.source)) {
    problems.push('source must be a bundled asset (data:, blob:, or same-origin path), not a remote URL');
  }
  if (!isFinitePositive(asset.width) || !isFinitePositive(asset.height)) {
    problems.push('width and height must be positive finite numbers');
  }
  if (!within(asset.pivot.x, asset.width) || !within(asset.pivot.y, asset.height)) {
    problems.push('pivot must lie inside the texture');
  }
  if (!within(asset.ropeAnchor.x, asset.width) || !within(asset.ropeAnchor.y, asset.height)) {
    problems.push('ropeAnchor must lie inside the texture');
  }
  if (!isFinitePositive(asset.bodyDiameter)) {
    problems.push('bodyDiameter must be a positive finite number');
  } else if (asset.bodyDiameter > Math.max(asset.width, asset.height)) {
    problems.push('bodyDiameter cannot exceed the texture size');
  }
  return problems;
}
