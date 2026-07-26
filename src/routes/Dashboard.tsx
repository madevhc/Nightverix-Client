import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PublicAccount,
  getActiveAccount,
  getSystemInfo,
  listInstances,
} from "../tauri";
import { PageScene } from "../PageScene";
import "./Dashboard.css";

const NEWS = [
  {
    tag: "Novedad",
    title: "Cuentas de Microsoft reales",
    body: "El login ya pasa por Xbox Live y XSTS de verdad, con selector multi-cuenta.",
    icon: <UserIcon />,
  },
  {
    tag: "Rendimiento",
    title: "Descargas de assets en paralelo",
    body: "24 archivos a la vez en vez de uno por uno — instancias listas mucho antes.",
    icon: <BoltIcon />,
  },
  {
    tag: "En camino",
    title: "Soporte para Fabric y Forge",
    body: "Vanilla ya funciona de punta a punta. Los loaders con mods son el siguiente paso.",
    icon: <PuzzleIcon />,
  },
];

function skinHeadUrl(username: string) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`;
}

export default function Dashboard() {
  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [instanceCount, setInstanceCount] = useState(0);
  const [ramTotalMb, setRamTotalMb] = useState<number | null>(null);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [fps, setFps] = useState(0);
  const [pingMs, setPingMs] = useState<number | null>(null);

  // ── Datos reales (no inventados) ──────────────────────────────────────
  useEffect(() => {
    getActiveAccount().then(setAccount).catch(() => setAccount(null));
    listInstances().then((list) => setInstanceCount(list.length));
    getSystemInfo().then((info) => {
      setRamTotalMb(info.totalMemoryMb);
      setAppVersion(info.appVersion);
    });
  }, []);

  // FPS real de la propia interfaz (no del juego, del launcher).
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf: number;
    function tick(now: number) {
      frames++;
      if (now - last >= 1000) {
        setFps(frames);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Ping real: tiempo de ida y vuelta a los servidores de Mojang.
  useEffect(() => {
    let cancelled = false;
    async function measure() {
      const start = performance.now();
      try {
        await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", { method: "HEAD", cache: "no-store" });
        if (!cancelled) setPingMs(Math.round(performance.now() - start));
      } catch {
        if (!cancelled) setPingMs(null);
      }
    }
    measure();
    const interval = setInterval(measure, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <PageScene>
      <div className="mainmenu__brand">
        <img src="/nightverix-icon.png" alt="" className="mainmenu__logo" />
        NIGHTVERIX
      </div>

      <div className="mainmenu__main">
        <div className="glass-card glass-card--hero">
          <img src="/nightverix-icon.png" alt="" className="glass-card__watermark" />

          <div className="glass-card--hero__body">
            <span className="mainmenu__eyebrow">Bienvenido de vuelta</span>
            <h1>{account ? account.username : "Jugador"}</h1>
            <p>Tu biblioteca, tus mods y tu cuenta, todo desde aquí.</p>

            <Link to="/library" className="glow-btn">
              <span>▶ Jugar</span>
            </Link>

            <div className="mainmenu__chips">
              <Link to="/library" className="mainmenu__chip">
                <strong>{instanceCount}</strong>
                <span>Instancias</span>
              </Link>
              <Link to="/mods" className="mainmenu__chip">
                <strong>0</strong>
                <span>Mods</span>
              </Link>
              <Link to="/account" className="mainmenu__chip">
                <strong>{account ? "●" : "—"}</strong>
                <span>{account ? "Cuenta activa" : "Sin sesión"}</span>
              </Link>
            </div>
          </div>
        </div>

        <aside className="glass-card glass-card--news">
          <h2>Noticias</h2>
          <div className="news-list">
            {NEWS.map((item) => (
              <div className="news-item" key={item.title}>
                <div className="news-item__thumb">{item.icon}</div>
                <div>
                  <span className="news-item__tag">{item.tag}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="statusbar">
        <div className="statusbar__user">
          {account ? (
            <img src={skinHeadUrl(account.username)} alt="" className="statusbar__avatar" />
          ) : (
            <span className="statusbar__avatar statusbar__avatar--empty" />
          )}
          <span>{account ? account.username : "Sin iniciar sesión"}</span>
        </div>

        <div className="statusbar__metrics">
          <span title="Versión de Nightverix Client">v{appVersion}</span>
          <span title="Fotogramas por segundo de la interfaz">{fps} FPS</span>
          <span title="RAM total del sistema">{ramTotalMb ? `${(ramTotalMb / 1024).toFixed(1)} GB` : "…"}</span>
          <span title="Latencia a los servidores de Mojang">{pingMs != null ? `${pingMs} ms` : "sin conexión"}</span>
        </div>
      </div>
    </PageScene>
  );
}

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8.2" r="3.4" stroke="#fff" strokeWidth="1.6" />
      <path d="M5 19.5c0-3.3 3.13-6 7-6s7 2.7 7 6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function PuzzleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M9.5 4.5h3a1.5 1.5 0 0 1 1.5 1.9c-.1.5.3 1.1.9 1.1H16a2 2 0 0 1 2 2v1.6c0 .6.6 1 1.1.9a1.5 1.5 0 0 1 1.9 1.5v3a1.5 1.5 0 0 1-1.9 1.5c-.5-.1-1.1.3-1.1.9V21a2 2 0 0 1-2 2h-1.6c-.6 0-1-.6-.9-1.1a1.5 1.5 0 0 0-1.5-1.9h-3a1.5 1.5 0 0 0-1.5 1.9c.1.5-.3 1.1-.9 1.1H5a2 2 0 0 1-2-2v-1.6c0-.6-.6-1-1.1-.9A1.5 1.5 0 0 1 .5 15.9v-3a1.5 1.5 0 0 1 1.9-1.5c.5.1 1.1-.3 1.1-.9V9a2 2 0 0 1 2-2h1.6c.6 0 1-.6.9-1.1A1.5 1.5 0 0 1 9.5 4.5Z"
        stroke="#fff"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
