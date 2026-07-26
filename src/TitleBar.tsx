import { windowControls } from "./tauri";
import "./TitleBar.css";

export function TitleBar() {
  return (
    <header className="titlebar">
      <div className="titlebar__drag" data-tauri-drag-region />

      <div className="titlebar__brand">
        <span className="titlebar__dot" aria-hidden="true" />
        <span>Nightverix Client</span>
      </div>

      <div className="titlebar__controls">
        <button
          type="button"
          className="titlebar__button"
          aria-label="Minimizar ventana"
          onClick={() => void windowControls.minimize()}
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          className="titlebar__button"
          aria-label="Maximizar ventana"
          onClick={() => void windowControls.toggleMaximize()}
        >
          <MaximizeIcon />
        </button>
        <button
          type="button"
          className="titlebar__button titlebar__button--close"
          aria-label="Cerrar ventana"
          onClick={() => void windowControls.close()}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 1" fill="none">
      <rect width="10" height="1" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path
        d="M1 1L9 9M9 1L1 9"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}
