import { useEffect, useState } from 'react';
import type {} from '../preload';

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
      {/* Test charm: a colored circle hanging near the top of the overlay.
          Physics and dragging arrive in a later milestone. */}
      <div className="charm" aria-hidden="true" />

      <section className="overlay__panel">
        <h1 className="overlay__title">Hangly Desktop Companion</h1>
        <p className="overlay__subtitle">
          Overlay milestone &mdash; frameless, transparent, always on top.
        </p>
        <ul className="overlay__facts">
          <li>
            <span className="overlay__fact-label">Window</span>
            <span>Frameless &middot; transparent &middot; always-on-top</span>
          </li>
          <li>
            <span className="overlay__fact-label">Bridge</span>
            <span>
              <code>window.hangly</code> (contextIsolation + sandbox)
            </span>
          </li>
          <li>
            <span className="overlay__fact-label">Version</span>
            <span>{version || '…'}</span>
          </li>
        </ul>
        <p className="overlay__hint">
          <kbd>Esc</kbd> hides the overlay &middot;{' '}
          <kbd>Ctrl+Shift+H</kbd> toggles it &middot;{' '}
          <kbd>Ctrl+Shift+Q</kbd> quits &middot; tray icon has a menu too.
        </p>
      </section>
    </main>
  );
}
