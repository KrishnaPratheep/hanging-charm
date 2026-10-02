import { useEffect, useRef } from 'react';
import { createCharmScene } from './physics/scene';
import { createCharmView } from './physics/view';
import { getDefaultCharmAsset } from './charms/registry';

/**
 * The physics/render pipeline for the hanging charm.
 *
 * One loop drives everything: Pixi's ticker reports the real frame delta, that
 * delta feeds a fixed 60 Hz clock (the only thing Matter ever sees), and Pixi
 * draws a pose interpolated between the previous and current physics state.
 *
 * The renderer reads physics, never writes it. The only exception is explicit
 * user interaction: grabbing the charm calls into the scene, which adds a
 * temporary drag constraint; the solver still does all the moving.
 */
export default function CharmSimulation() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    let teardown: (() => void) | undefined;

    const start = async (): Promise<void> => {
      const scene = createCharmScene(
        host.clientWidth || window.innerWidth,
        host.clientHeight || window.innerHeight,
      );
      // The visual layer decides what the charm looks like; the physics scene
      // only ever sees a body and its pose. Swap the asset id here to change
      // the charm without touching physics.
      const view = await createCharmView(host, getDefaultCharmAsset());
      if (disposed) {
        // React StrictMode (or a fast unmount) raced us here.
        view.destroy();
        scene.dispose();
        return;
      }

      const { fixedTimestepMs, maxFrameDeltaMs, maxSubSteps } = scene.config;
      let accumulator = 0;

      const advance = (): void => {
        // Real elapsed time, clamped so one long stall can't explode the sim.
        const deltaMs = Math.min(view.app.ticker.deltaMS, maxFrameDeltaMs);
        accumulator += deltaMs;

        let steps = 0;
        while (accumulator >= fixedTimestepMs && steps < maxSubSteps) {
          scene.step(fixedTimestepMs);
          accumulator -= fixedTimestepMs;
          steps += 1;
        }
        if (accumulator >= fixedTimestepMs) {
          accumulator = 0; // Drop a backlog we could not simulate in time.
        }

        // The leftover fraction of a step is exactly where "now" sits between
        // the pose we just simulated and the one before it.
        view.draw(scene.sample(accumulator / fixedTimestepMs), deltaMs);
      };

      // Pointer interaction: the view reports intent (world coordinates), the
      // scene owns all physics changes. Releasing hands the charm back to
      // gravity and the rope with its momentum intact.
      view.bindInteraction({
        onGrab: (point) => scene.beginDrag(point),
        onMove: (point) => scene.moveDrag(point),
        onRelease: () => {
          scene.endDrag();
        },
      });

      view.app.ticker.add(advance);

      // Dev-only reports: `ELECTRON_ENABLE_LOGGING=1 npm start` shows whether
      // the rope swings and settles at its rest length with a stable solver.
      const report = (label: string): void => {
        const d = scene.diagnostics();
        console.info(
          `[charm ${label}] anchor→charm ${d.charmDistanceFromAnchor.toFixed(1)}px of ` +
            `${d.restDistance.toFixed(1)}px rest · max link stretch ` +
            `${(d.maxLinkStretch * 100).toFixed(1)}% · charm speed ` +
            `${d.charmSpeed.toFixed(2)}px/step`,
        );
      };
      const diagnosticsTimers = import.meta.env.DEV
        ? [
            window.setTimeout(() => report('3s'), 3000),
            window.setTimeout(() => report('10s'), 10000),
          ]
        : [];

      teardown = () => {
        view.app.ticker.remove(advance);
        for (const timer of diagnosticsTimers) {
          window.clearTimeout(timer);
        }
        view.destroy();
        scene.dispose();
      };
    };

    void start();

    return () => {
      disposed = true;
      teardown?.();
    };
  }, []);

  return <div ref={hostRef} className="charm-stage" aria-hidden="true" />;
}
