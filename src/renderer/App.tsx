import { useEffect, useState } from 'react';
import type {} from '../preload';

export default function App() {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    setVersion(window.hangly.app.getVersion());
  }, []);

  return (
    <main className="app">
      <div className="app__card">
        <h1 className="app__title">Hangly Desktop Companion</h1>
        <p className="app__subtitle">
          Foundation build &mdash; Electron + React + TypeScript + Vite.
        </p>
        <ul className="app__facts">
          <li>
            <span className="app__fact-label">Renderer</span>
            <span>React running in a sandboxed, context-isolated window</span>
          </li>
          <li>
            <span className="app__fact-label">Preload</span>
            <span>
              Minimal bridge exposed as <code>window.hangly</code>
            </span>
          </li>
          <li>
            <span className="app__fact-label">Version</span>
            <span>{version || '…'}</span>
          </li>
        </ul>
        <p className="app__hint">
          Features arrive later &mdash; this screen just proves the pipeline
          works end to end.
        </p>
      </div>
    </main>
  );
}
