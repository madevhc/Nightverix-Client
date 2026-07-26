import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../EmptyState";
import { Button } from "../Button";
import { Sparkline } from "../Sparkline";
import { Instance, InstanceStats, getInstanceStats, listInstances } from "../tauri";
import { useRunningInstances } from "../RunningInstancesContext";
import { PageScene, PageHeader } from "../PageScene";
import "./Instances.css";

const HISTORY_LENGTH = 30;
const POLL_MS = 2000;

export default function Instances() {
  const { running, setActiveConsoleId, activeConsoleId } = useRunningInstances();
  const [instances, setInstances] = useState<Instance[]>([]);

  useEffect(() => {
    listInstances().then(setInstances);
  }, [running.length]);

  if (running.length === 0) {
    return (
      <PageScene>
        <div className="instances">
          <PageHeader
            eyebrow="Instancias"
            title="Rendimiento en vivo"
            subtitle="El estado y el rendimiento de tus instancias en ejecución vivirán aquí."
          />

          <EmptyState
            icon={<GridIcon />}
            title="No hay instancias en ejecución"
            description="Cuando crees una instancia desde la Biblioteca, podrás iniciarla, ver su consumo de RAM y revisar sus registros desde esta pantalla."
          />
        </div>
      </PageScene>
    );
  }

  return (
    <PageScene>
      <div className="instances">
        <PageHeader
          eyebrow="Instancias"
          title="Rendimiento en vivo"
          subtitle={`${running.length} ${running.length === 1 ? "instancia en ejecución" : "instancias en ejecución"}.`}
        />

        <div className="instances__grid">
          {running.map((r) => {
            const inst = instances.find((i) => i.id === r.instanceId);
            return (
              <RunningInstanceCard
                key={r.instanceId}
                instanceId={r.instanceId}
                name={inst?.name ?? r.versionId}
                versionId={r.versionId}
                startedAt={r.startedAt}
                isActiveConsole={activeConsoleId === r.instanceId}
                onOpenConsole={() => setActiveConsoleId(r.instanceId)}
              />
            );
          })}
        </div>
      </div>
    </PageScene>
  );
}

function formatUptime(startedAt: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - startedAt));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function RunningInstanceCard({
  instanceId,
  name,
  versionId,
  startedAt,
  isActiveConsole,
  onOpenConsole,
}: {
  instanceId: string;
  name: string;
  versionId: string;
  startedAt: number;
  isActiveConsole: boolean;
  onOpenConsole: () => void;
}) {
  const [history, setHistory] = useState<number[]>([]);
  const [stats, setStats] = useState<InstanceStats | null>(null);
  const [uptime, setUptime] = useState(() => formatUptime(startedAt));
  const failuresRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const s = await getInstanceStats(instanceId);
        if (cancelled) return;
        failuresRef.current = 0;
        setStats(s);
        setHistory((prev) => {
          const next = [...prev, s.memoryMb];
          return next.length > HISTORY_LENGTH ? next.slice(-HISTORY_LENGTH) : next;
        });
      } catch {
        failuresRef.current += 1;
      }
    }

    poll();
    const statsInterval = setInterval(poll, POLL_MS);
    const uptimeInterval = setInterval(() => setUptime(formatUptime(startedAt)), 1000);

    return () => {
      cancelled = true;
      clearInterval(statsInterval);
      clearInterval(uptimeInterval);
    };
  }, [instanceId, startedAt]);

  return (
    <div className="instance-card">
      <div className="instance-card__top">
        <div>
          <span className="instance-card__badge">
            <span className="instance-card__dot" /> En ejecución
          </span>
          <h3>{name}</h3>
          <span className="instance-card__meta">{versionId} · {uptime}</span>
        </div>
        <Button
          variant={isActiveConsole ? "primary" : "secondary"}
          size="sm"
          onClick={onOpenConsole}
        >
          Ver consola
        </Button>
      </div>

      <div className="instance-card__stats">
        <div className="instance-card__stat">
          <div className="instance-card__stat-label">
            <span>RAM</span>
            <strong>{stats ? `${stats.memoryMb} MB` : "…"}</strong>
          </div>
          <Sparkline values={history} height={44} />
        </div>

        <div className="instance-card__side">
          <div className="instance-card__cpu">
            <span>CPU</span>
            <strong>{stats ? `${stats.cpuPercent.toFixed(0)}%` : "…"}</strong>
          </div>
          <div className="instance-card__cpu">
            <span>GPU</span>
            <strong>{stats?.gpuPercent != null ? `${stats.gpuPercent.toFixed(0)}%` : "N/D"}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function GridIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
