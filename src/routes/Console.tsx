import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../EmptyState";
import { Instance, listInstances } from "../tauri";
import { useRunningInstances } from "../RunningInstancesContext";
import { PageScene, PageHeader } from "../PageScene";
import "./Console.css";

export default function ConsolePage() {
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

  const availableIds = Object.keys(consoleLines).filter((id) => consoleLines[id]?.length);
  const shownId = activeConsoleId && availableIds.includes(activeConsoleId) ? activeConsoleId : availableIds[0] ?? null;

  useEffect(() => {
    listInstances().then(setInstances);
  }, [availableIds.length]);

  useEffect(() => {
    if (shownId && shownId !== activeConsoleId) setActiveConsoleId(shownId);
  }, [shownId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [shownId, consoleLines]);

  if (availableIds.length === 0) {
    return (
      <PageScene>
      <div className="console-page">
        <PageHeader
          eyebrow="Consola"
          title="Salida de Java"
          subtitle="Aquí verás en grande la salida de Java de tus partidas."
        />
        <EmptyState
          icon={<TerminalIconBig />}
          title="Todavía no hay nada que mostrar"
          description="Lanza una instancia desde la Biblioteca y su consola aparecerá aquí."
        />
      </div>
      </PageScene>
    );
  }

  const lines = shownId ? consoleLines[shownId] ?? [] : [];
  const shownInstance = instances.find((i) => i.id === shownId);
  const activeJavaMissing = javaMissing && shownId && javaMissing.instanceId === shownId ? javaMissing : null;

  return (
    <PageScene>
    <div className="console-page">
      <PageHeader
        eyebrow="Consola"
        title="Salida de Java"
        subtitle="Salida en vivo del proceso de Java."
      />

      {availableIds.length > 1 && (
        <div className="console-page__tabs">
          {availableIds.map((id) => {
            const inst = instances.find((i) => i.id === id);
            return (
              <button
                key={id}
                type="button"
                className={`console-page__tab ${id === shownId ? "console-page__tab--active" : ""}`}
                onClick={() => setActiveConsoleId(id)}
              >
                {inst?.name ?? id.slice(0, 6)}
                {isRunning(id) && <span className="console-page__tab-dot" />}
              </button>
            );
          })}
        </div>
      )}

      {activeJavaMissing && shownInstance && (
        <div className="console-page__java-prompt">
          <span>A esta instancia le falta Java {activeJavaMissing.major}.</span>
          {installingJava ? (
            <span className="console-page__java-status">
              {javaInstallProgress?.detail ?? "Instalando…"}
            </span>
          ) : (
            <button type="button" onClick={() => installMissingJava(shownInstance)}>
              Instalar Java {activeJavaMissing.major} automáticamente
            </button>
          )}
        </div>
      )}

      <div className="console-page__log">
        {lines.map((line, i) => {
          const isNightverix = line.startsWith("[nightverix]");
          return (
            <div
              key={i}
              className={`console-page__line ${isNightverix ? "console-page__line--nightverix" : ""}`}
            >
              {line}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
    </PageScene>
  );
}

function TerminalIconBig() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 9l3 3-3 3M12 15h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
