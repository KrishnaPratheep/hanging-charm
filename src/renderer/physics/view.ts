import {
  Application,
  Circle,
  Graphics,
  Sprite,
  Texture,
  type FederatedPointerEvent,
} from 'pixi.js';
import { charmPhysicsConfig } from './config';
import type { CharmSample, Point } from './scene';
import type { CharmAsset } from '../charms/types';

/** Pointer intents emitted by the view, already converted to world coordinates. */
export interface CharmPointerHandlers {
  /** Pointer went down on the charm; return true if the drag actually started. */
  onGrab(point: Point): boolean;
  /** Pointer moved while the drag is captured (world coordinates). */
  onMove(point: Point): void;
  /** Pointer released, cancelled, or the window lost focus. */
  onRelease(): void;
}

export interface CharmView {
  readonly app: Application;
  /** Draws one interpolated physics pose plus interaction feedback. */
  draw(sample: CharmSample, deltaMs: number): void;
  /** Wires pointer interaction; call once after the view is created. */
  bindInteraction(handlers: CharmPointerHandlers): void;
  destroy(): void;
}

const ROPE_SHADOW = 0x1f2a31;
const ROPE_CORE = 0xcfd9e0;
/** Hover/grab ring uses the charm's own accent, sampled from the asset. */
const ACCENT = 0x4cc38a;

/** Visual feedback targets while hovered / grabbed (subtle by design). */
const HOVER_SCALE = 1.03;
const GRAB_SCALE = 1.08;
const HOVER_GLOW = 0.28;
const GRAB_GLOW = 0.5;
/** Time constant (ms) for easing the feedback in the render loop. */
const FEEDBACK_TAU = 90;

/**
 * Traces a smooth curve through the rope points using midpoint quadratics:
 * each physics point becomes a control point and each midpoint an on-curve
 * anchor, which hides the polygonal look of short rope links.
 */
const traceRope = (graphics: Graphics, points: readonly Point[]): void => {
  graphics.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    graphics.quadraticCurveTo(
      current.x,
      current.y,
      (current.x + next.x) / 2,
      (current.y + next.y) / 2,
    );
  }
  const last = points[points.length - 1];
  graphics.lineTo(last.x, last.y);
};

/**
 * Loads the texture for a charm asset on the main thread.
 *
 * Built-in sources are bundled data: URIs (production) or same-origin URLs
 * (dev) — both allowed by `img-src 'self' data:`. We deliberately avoid
 * `Assets.load` here: its loader spawns blob-URL web workers, which a strict
 * CSP without `worker-src` blocks, hanging the load. One small PNG decoded
 * via `Image` costs nothing and keeps the CSP tight.
 */
async function loadCharmTexture(asset: CharmAsset): Promise<Texture> {
  try {
    const image = new Image();
    image.src = asset.source;
    await image.decode();
    return Texture.from(image);
  } catch (error) {
    console.error(`[charms] failed to load texture for "${asset.id}", charm will be hidden`, error);
    // The empty texture renders nothing but keeps physics, interaction, and
    // the rest of the overlay alive if a texture is somehow broken.
    return Texture.EMPTY;
  }
}

/**
 * Creates the PixiJS renderer inside `host`. The canvas is fully transparent
 * (`backgroundAlpha: 0`) so the Electron overlay window stays see-through.
 *
 * The charm's appearance comes entirely from the passed `CharmAsset`; the
 * physics body size stays fixed in `charmPhysicsConfig` regardless of texture
 * dimensions.
 */
export async function createCharmView(
  host: HTMLElement,
  asset: CharmAsset,
): Promise<CharmView> {
  const app = new Application();
  await app.init({
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    resizeTo: host,
    // WebGL is the most predictable path inside a transparent Electron window.
    preference: 'webgl',
  });

  app.canvas.style.display = 'block';
  host.appendChild(app.canvas);

  const ropeLayer = new Graphics();
  const pinLayer = new Graphics();
  const charmLayer = new Sprite();
  const ringLayer = new Graphics();
  app.stage.addChild(ropeLayer, pinLayer, charmLayer, ringLayer);

  const texture = await loadCharmTexture(asset);

  // Map the texture onto the fixed physics body: `asset.bodyDiameter` texture
  // pixels must cover the physics diameter in world units. Pivot goes at the
  // asset's center so position/rotation match the body's center pose exactly.
  const physicsDiameter = charmPhysicsConfig.charmRadius * 2;
  const spriteScale = physicsDiameter / asset.bodyDiameter;
  charmLayer.texture = texture;
  charmLayer.anchor.set(
    asset.pivot.x / asset.width,
    asset.pivot.y / asset.height,
  );
  charmLayer.scale.set(spriteScale);
  const charmWorldRadius = (asset.width * spriteScale) / 2;

  // Hover/grab highlight ring; alpha is eased in the render loop. The ring
  // tracks the charm's visual size, not the physics radius.
  ringLayer.circle(0, 0, charmWorldRadius + 4).stroke({ width: 2, color: ACCENT });
  ringLayer.alpha = 0;
  ringLayer.eventMode = 'none';

  // Only the charm is interactive — the rest of the overlay ignores pointers.
  charmLayer.eventMode = 'static';
  // Hit test happens in the sprite's raw local space. The anchor shifts the
  // texture quad so the pivot lands exactly at local (0,0) — the object's
  // position IS the pivot — so the circle must be centered at the origin, not
  // at (pivot.x, pivot.y).
  charmLayer.hitArea = new Circle(0, 0, asset.bodyDiameter / 2 + 14);
  charmLayer.cursor = 'grab';

  let handlers: CharmPointerHandlers | null = null;
  let hovered = false;
  let dragging = false;
  let scale = 1;
  let glow = 0;

  /**
   * Converts document client coordinates into Matter world coordinates.
   *
   * World units are CSS pixels of the stage. The canvas backing store is
   * scaled by `devicePixelRatio` via Pixi's autoDensity/resolution, but that
   * happens inside the renderer: logical canvas and stage coordinates stay in
   * CSS pixels. `toLocal` applies the (currently identity) stage transform, so
   * this remains correct if the stage ever gains a scale or offset.
   */
  const clientToWorld = (clientX: number, clientY: number): Point | null => {
    const rect = app.canvas.getBoundingClientRect();
    const local = app.stage.toLocal({ x: clientX - rect.left, y: clientY - rect.top });
    return Number.isFinite(local.x) && Number.isFinite(local.y)
      ? { x: local.x, y: local.y }
      : null;
  };

  /** Same conversion for Pixi federated events (global == canvas client space). */
  const eventToWorld = (event: FederatedPointerEvent): Point | null => {
    const local = event.getLocalPosition(app.stage);
    return Number.isFinite(local.x) && Number.isFinite(local.y)
      ? { x: local.x, y: local.y }
      : null;
  };

  // Native pointer capture keeps move/up events coming even when the pointer
  // leaves the charm — or the window — mid-drag. Pixi's own event system has no
  // capture, so the canvas element takes it.
  let capturedPointerId: number | null = null;

  const onCapturedMove = (event: PointerEvent): void => {
    if (!dragging || capturedPointerId === null || event.pointerId !== capturedPointerId) {
      return;
    }
    const point = clientToWorld(event.clientX, event.clientY);
    if (point) {
      handlers?.onMove(point);
    }
  };

  const onCapturedEnd = (event: PointerEvent): void => {
    if (!dragging || (capturedPointerId !== null && event.pointerId !== capturedPointerId)) {
      return;
    }
    finishDrag();
  };

  /** Alt+Tab or a window drag mid-drag must not leave the charm stuck. */
  const onWindowBlur = (): void => {
    finishDrag();
  };

  const detachDomListeners = (): void => {
    app.canvas.removeEventListener('pointermove', onCapturedMove);
    window.removeEventListener('pointerup', onCapturedEnd);
    window.removeEventListener('pointercancel', onCapturedEnd);
    window.removeEventListener('blur', onWindowBlur);
    if (capturedPointerId !== null) {
      if (app.canvas.hasPointerCapture(capturedPointerId)) {
        app.canvas.releasePointerCapture(capturedPointerId);
      }
      capturedPointerId = null;
    }
  };

  function finishDrag(): void {
    if (!dragging) {
      return;
    }
    detachDomListeners();
    dragging = false;
    charmLayer.cursor = 'grab';
    app.canvas.style.cursor = '';
    handlers?.onRelease();
  }

  const setDragging = (value: boolean): void => {
    dragging = value;
    charmLayer.cursor = value ? 'grabbing' : 'grab';
    app.canvas.style.cursor = value ? 'grabbing' : '';
  };

  // --- Pixi federated pointer events ----------------------------------------
  charmLayer.on('pointerover', () => {
    hovered = true;
  });

  charmLayer.on('pointerout', () => {
    if (!dragging) {
      hovered = false;
    }
  });

  charmLayer.on('pointermove', (event: FederatedPointerEvent) => {
    if (!dragging) {
      return;
    }
    const point = eventToWorld(event);
    if (point) {
      handlers?.onMove(point);
    }
  });

  charmLayer.on('pointerdown', (event: FederatedPointerEvent) => {
    if (!handlers || dragging || event.button !== 0) {
      return;
    }
    const point = eventToWorld(event);
    if (!point || !handlers.onGrab(point)) {
      return;
    }
    event.preventDefault();
    setDragging(true);
    capturedPointerId = event.pointerId;
    try {
      app.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best effort; the window-level listeners below still end the drag.
    }
    app.canvas.addEventListener('pointermove', onCapturedMove);
    window.addEventListener('pointerup', onCapturedEnd);
    window.addEventListener('pointercancel', onCapturedEnd);
    window.addEventListener('blur', onWindowBlur);
  });

  charmLayer.on('pointerup', () => {
    finishDrag();
  });

  charmLayer.on('pointerupoutside', () => {
    finishDrag();
  });

  let pinDrawn = false;

  const draw = (sample: CharmSample, deltaMs: number): void => {
    const { points, charmAngle } = sample;

    // Two strokes: a wide dark one for depth, a thin light core on top.
    ropeLayer.clear();
    traceRope(ropeLayer, points);
    ropeLayer.stroke({ width: 4.5, color: ROPE_SHADOW, alpha: 0.9, cap: 'round', join: 'round' });
    traceRope(ropeLayer, points);
    ropeLayer.stroke({ width: 2.2, color: ROPE_CORE, alpha: 0.95, cap: 'round', join: 'round' });

    if (!pinDrawn) {
      // The anchor is static, so the pin only needs to be drawn once.
      const anchor = points[0];
      pinLayer
        .circle(anchor.x, anchor.y, 4.5)
        .fill({ color: ROPE_SHADOW })
        .stroke({ width: 1.5, color: ROPE_CORE, alpha: 0.7 });
      pinDrawn = true;
    }

    // The sprite pivot sits exactly on the body's center pose; rotation comes
    // straight from physics, so the artwork swings with the body.
    const charmPoint = points[points.length - 1];
    charmLayer.position.set(charmPoint.x, charmPoint.y);
    charmLayer.rotation = charmAngle;
    ringLayer.position.set(charmPoint.x, charmPoint.y);

    // Ease hover/grab feedback inside the existing loop — no extra timers.
    const targetScale = dragging ? GRAB_SCALE : hovered ? HOVER_SCALE : 1;
    const targetGlow = dragging ? GRAB_GLOW : hovered ? HOVER_GLOW : 0;
    const k = 1 - Math.exp(-Math.max(0, deltaMs) / FEEDBACK_TAU);
    scale += (targetScale - scale) * k;
    glow += (targetGlow - glow) * k;
    charmLayer.scale.set(spriteScale * scale);
    ringLayer.alpha = glow;
  };

  const bindInteraction = (next: CharmPointerHandlers): void => {
    handlers = next;
  };

  const destroy = (): void => {
    detachDomListeners();
    dragging = false;
    handlers = null;
    app.destroy(true, { children: true });
  };

  return { app, draw, bindInteraction, destroy };
}
