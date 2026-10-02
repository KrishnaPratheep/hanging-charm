/**
 * Registry of built-in visual charm assets.
 *
 * The physics scene never imports this module — the view resolves the selected
 * asset through it, so swapping a charm never touches physics. Adding a charm
 * is a local change: drop a PNG in `assets/charms/`, import it below, and
 * append a `CharmAsset` entry.
 */
import starPng from '../assets/charms/star.png';
import { validateCharmAsset, type CharmAsset } from './types';

/** All built-in charms. `defaultId` picks what a fresh install shows. */
const charmAssets: readonly CharmAsset[] = [
  {
    id: 'star',
    name: 'Lucky Star',
    type: 'star',
    // In production Vite inlines this below assetsInlineLimit as a data: URI;
    // in dev it resolves to a same-origin URL. Either way it satisfies CSP.
    source: starPng,
    width: 128,
    height: 128,
    pivot: { x: 64, y: 64 },
    ropeAnchor: { x: 64, y: 12 },
    // Valley-to-valley diameter: the star's solid body maps onto the physics
    // circle, so the tips overhang it visually without affecting physics.
    bodyDiameter: 46,
  },
];

export const defaultCharmId = 'star';

/** Maps asset ids to entries; registration failures land here with reasons. */
const registry = new Map<string, CharmAsset>();
const registrationProblems = new Map<string, string[]>();

for (const asset of charmAssets) {
  const problems = validateCharmAsset(asset);
  if (problems.length === 0) {
    registry.set(asset.id, asset);
  } else {
    registrationProblems.set(asset.id, problems);
  }
}

if (registrationProblems.size > 0) {
  console.error(
    '[charms] invalid asset definitions skipped:',
    Object.fromEntries(registrationProblems),
  );
}

/** Every registered asset (for future pickers). */
export function listCharmAssets(): readonly CharmAsset[] {
  return [...registry.values()];
}

/** The asset a fresh install shows. */
export function getDefaultCharmAsset(): CharmAsset {
  const asset = registry.get(defaultCharmId);
  if (!asset) {
    throw new Error(`[charms] default asset "${defaultCharmId}" failed registration`);
  }
  return asset;
}

/**
 * Resolves an asset by id. Unknown or invalid ids fall back to the default
 * (never undefined), so a bad id can never break the overlay.
 */
export function getCharmAsset(id: string | undefined | null): CharmAsset {
  const asset = id != null ? registry.get(id) : undefined;
  return asset ?? getDefaultCharmAsset();
}

/** Whether an id is a registered, valid asset (used by tests and future UI). */
export function hasCharmAsset(id: string): boolean {
  return registry.has(id);
}

/** Registration problems keyed by id; empty in a healthy build. */
export function getCharmRegistrationProblems(): ReadonlyMap<string, string[]> {
  return registrationProblems;
}
