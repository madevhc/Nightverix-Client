import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  DownloadProgress,
  Instance,
  JavaMissingInfo,
  RunningInstanceInfo,
  installJava,
  launchInstance,
  listRunningInstances,
  onDownloadProgress,
  onGameExit,
  onGameLog,
  onInstancesChanged,
  parseJavaMissing,
} from "./tauri";

interface JavaMissingState extends JavaMissingInfo {
  instanceId: string;
}

interface RunningInstancesValue {
  running: RunningInstanceInfo[];
  consoleLines: Record<string, string[]>;
  activeConsoleId: string | null;
  setActiveConsoleId: (id: string | null) => void;
  isRunning: (instanceId: string) => boolean;
  play: (instance: Instance) => Promise<void>;
  javaMissing: JavaMissingState | null;
  javaInstallProgress: DownloadProgress | null;
  installingJava: boolean;
  installMissingJava: (instance: Instance) => Promise<void>;
}

const RunningInstancesContext = createContext<RunningInstancesValue | null>(null);

export function RunningInstancesProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState<RunningInstanceInfo[]>([]);
  const [consoleLines, setConsoleLines] = useState<Record<string, string[]>>({});
  const [activeConsoleId, setActiveConsoleId] = useState<string | null>(null);
  const [javaMissing, setJavaMissing] = useState<JavaMissingState | null>(null);
  const [javaInstallProgress, setJavaInstallProgress] = useState<DownloadProgress | null>(null);
  const [installingJava, setInstallingJava] = useState(false);

  async function refresh() {
    setRunning(await listRunningInstances());
  }

  useEffect(() => {
    refresh();

    const unlistenLog = onGameLog(({ instanceId, line }) => {
      setConsoleLines((prev) => {
        const existing = prev[instanceId] ?? [];
        const next = existing.length > 500 ? [...existing.slice(-500), line] : [...existing, line];
        return { ...prev, [instanceId]: next };
      });
    });
    const unlistenExit = onGameExit(({ instanceId, code }) => {
      setConsoleLines((prev) => ({
        ...prev,
        [instanceId]: [...(prev[instanceId] ?? []), `[nightverix] el juego se cerró (código ${code}).`],
      }));
      refresh();
    });
    const unlistenChanged = onInstancesChanged(() => refresh());
    const unlistenProgress = onDownloadProgress((p) => {
      if (p.stage === "java") setJavaInstallProgress(p);
    });

    return () => {
      unlistenLog.then((f) => f());
      unlistenExit.then((f) => f());
      unlistenChanged.then((f) => f());
      unlistenProgress.then((f) => f());
    };
  }, []);

  function isRunning(instanceId: string) {
    return running.some((r) => r.instanceId === instanceId);
  }

  async function play(instance: Instance) {
    setConsoleLines((prev) => ({ ...prev, [instance.id]: [] }));
    setActiveConsoleId(instance.id);
    setJavaMissing(null);
    try {
      await launchInstance(instance.id);
      await refresh();
    } catch (err) {
      const javaInfo = parseJavaMissing(String(err));
      if (javaInfo) {
        setJavaMissing({ ...javaInfo, instanceId: instance.id });
        setConsoleLines((prev) => ({
          ...prev,
          [instance.id]: [...(prev[instance.id] ?? []), `[nightverix] ${javaInfo.message}`],
        }));
      } else {
        setConsoleLines((prev) => ({
          ...prev,
          [instance.id]: [...(prev[instance.id] ?? []), `[nightverix] error: ${String(err)}`],
        }));
      }
    }
  }

  async function installMissingJava(instance: Instance) {
    const pending = javaMissing;
    if (!pending || pending.instanceId !== instance.id) return;
    setInstallingJava(true);
    setJavaInstallProgress(null);
    try {
      await installJava(pending.major);
      setJavaMissing(null);
      setConsoleLines((prev) => ({
        ...prev,
        [instance.id]: [...(prev[instance.id] ?? []), `[nightverix] Java ${pending.major} instalado — reintentando…`],
      }));
      await play(instance);
    } catch (err) {
      setConsoleLines((prev) => ({
        ...prev,
        [instance.id]: [...(prev[instance.id] ?? []), `[nightverix] no se pudo instalar Java automáticamente: ${String(err)}`],
      }));
    } finally {
      setInstallingJava(false);
      setJavaInstallProgress(null);
    }
  }

  return (
    <RunningInstancesContext.Provider
      value={{
        running,
        consoleLines,
        activeConsoleId,
        setActiveConsoleId,
        isRunning,
        play,
        javaMissing,
        javaInstallProgress,
        installingJava,
        installMissingJava,
      }}
    >
      {children}
    </RunningInstancesContext.Provider>
  );
}

export function useRunningInstances(): RunningInstancesValue {
  const ctx = useContext(RunningInstancesContext);
  if (!ctx) {
    throw new Error("useRunningInstances debe usarse dentro de <RunningInstancesProvider>");
  }
  return ctx;
}
