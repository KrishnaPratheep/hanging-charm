import { useEffect, useState } from 'react';
import type {} from '../preload';
import CharmSimulation from './CharmSimulation';

export default function App() {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    setVersion(window.hangly.app.getVersion());

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        window.hangly.overlay.hideOverlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main className="overlay">
      {/* The hanging charm: Matter.js physics drawn by PixiJS. */}
      <CharmSimulation />

      <section className="overlay__panel">
        <div className="overlay__header">
          <h1 className="overlay__title">Hangly Desktop Companion</h1>
          <span className="overlay__version">v{version || '…'}</span>
        </div>
        <p className="overlay__hint">
          Drag the charm &middot; Matter.js rope &middot; PixiJS rendering &mdash; <kbd>Esc</kbd> hides
          &middot; <kbd>Ctrl+Shift+H</kbd> toggles &middot; <kbd>Ctrl+Shift+Q</kbd> quits
        </p>
      </section>
    </main>
  );
}
