import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Instance, listInstances } from "./tauri";
import { useRunningInstances } from "./RunningInstancesContext";
import "./ConsolePanel.css";

export function ConsolePanel() {
  const {
    consoleLines,
    activeConsoleId,
    setActiveConsoleId,
    isRunning,
    javaMissing,
    javaInstallProgress,
    installingJava,
    installMissingJava,
  } = useRunningInstances();
  const [instances, setInstances] = useState<Instance[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    listInstances().then(setInstances);
  }, [activeConsoleId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [activeConsoleId, consoleLines]);

  if (!activeConsoleId) return null;
  if (location.pathname === "/console") return null; // ya está viendo la versión grande

  const runningIds = Object.keys(consoleLines).filter((id) => consoleLines[id]?.length);
  const activeLines = consoleLines[activeConsoleId] ?? [];
  const activeInstance = instances.find((i) => i.id === activeConsoleId);
  const activeJavaMissing = javaMissing && javaMissing.instanceId === activeConsoleId ? javaMissing : null;

  return (
    <div className="console-panel">
      {runningIds.length > 1 && (
        <div className="console-panel__tabs">
          {runningIds.map((id) => {
            const inst = instances.find((i) => i.id === id);
            return (
              <button
                key={id}
                type="button"
                className={`console-panel__tab ${id === activeConsoleId ? "console-panel__tab--active" : ""}`}
                onClick={() => setActiveConsoleId(id)}
              >
                {inst?.name ?? id.slice(0, 6)}
                {isRunning(id) && <span className="console-panel__tab-dot" />}
              </button>
            );
          })}
        </div>
      )}
      <div className="console-panel__bar">
        <span>Consola · {isRunning(activeConsoleId) ? "jugando" : "cerrado"}</span>
        <div className="console-panel__bar-actions">
          <button type="button" title="Ver en grande" onClick={() => navigate("/console")}>
            <ExpandIcon />
          </button>
          <button type="button" title="Cerrar" onClick={() => setActiveConsoleId(null)}>✕</button>
        </div>
      </div>
      {activeJavaMissing && activeInstance && (
        <div className="console-panel__java-prompt">
          <span>Falta Java {activeJavaMissing.major}.</span>
          {installingJava ? (
            <span className="console-panel__java-status">
              {javaInstallProgress?.detail ?? "Instalando…"}
            </span>
          ) : (
            <button type="button" onClick={() => installMissingJava(activeInstance)}>
              Instalar automáticamente
            </button>
          )}
        </div>
      )}
      <div className="console-panel__body">
        {activeLines.map((line, i) => {
          const isNightverix = line.startsWith("[nightverix]");
          return (
            <div
              key={i}
              className={`console-panel__line ${isNightverix ? "console-panel__line--nightverix" : ""}`}
            >
              {line}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M9 4H4v5M15 20h5v-5M20 4l-7 7M4 20l7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
