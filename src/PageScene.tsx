import { ReactNode } from "react";
import "./PageScene.css";

/**
 * Escena de fondo compartida por todas las pantallas: el mismo panorama
 * original (silueta de montañas, luna, estrellas). Fija, sin parallax de
 * ratón ni partículas — se veían de forma inconsistente entre Windows 10 y
 * 11 (probablemente por diferencias de aceleración por hardware/WebView2
 * entre versiones), así que se quitaron para que el fondo se vea igual en
 * cualquier equipo.
 */
export function PageScene({ children }: { children: ReactNode }) {
  return (
    <div className="page-scene">
      <div className="panorama">
        <div className="panorama__sky" />
        <div className="panorama__moon" />
        <div className="panorama__stars" />
        <div className="panorama__mountains panorama__mountains--far">
          <MountainSilhouette />
        </div>
        <div className="panorama__mountains panorama__mountains--near">
          <MountainSilhouette variant="near" />
        </div>

        <div className="panorama__vignette" />
      </div>

      <div className="page-scene__content">{children}</div>
    </div>
  );
}

function MountainSilhouette({ variant = "far" }: { variant?: "far" | "near" }) {
  const path =
    variant === "far"
      ? "M0,220 L60,150 L120,190 L200,110 L260,170 L340,90 L420,160 L500,120 L580,180 L660,130 L740,190 L820,140 L900,200 L980,150 L1080,220 L1080,300 L0,300 Z"
      : "M0,260 L80,180 L140,220 L220,140 L300,210 L380,160 L460,230 L540,170 L620,240 L700,180 L780,250 L860,190 L940,240 L1080,260 L1080,300 L0,300 Z";
  return (
    <svg viewBox="0 0 1080 300" preserveAspectRatio="none" width="100%" height="100%">
      <path d={path} />
    </svg>
  );
}

/** Cabecera "hero" con eyebrow + título + logo en marca de agua, para el
 * principio de cada pantalla — el mismo lenguaje visual del menú principal. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header glass-card">
      <img src="/nightverix-icon.png" alt="" className="page-header__watermark" />
      <div className="page-header__body">
        <span className="mainmenu__eyebrow">{eyebrow}</span>
        <div className="page-header__row">
          <div>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="page-header__actions">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
