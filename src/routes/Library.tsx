import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../Button";
import {
  DownloadProgress,
  FabricLoaderVersion,
  Instance,
  VersionSummary,
  createInstance,
  deleteInstance,
  downloadInstance,
  getFabricLoaderVersions,
  getForgeVersions,
  getVersionManifest,
  installJava,
  listInstances,
  onDownloadProgress,
  openInstanceFolder,
  parseJavaMissing,
} from "../tauri";
import { useRunningInstances } from "../RunningInstancesContext";
import { PageScene, PageHeader } from "../PageScene";
import "./Library.css";

type View = "grid" | "pick-loader" | "pick-version" | "pick-loader-version" | "name";

const LOADER_LABEL: Record<string, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
};

const LOADER_BADGE_STYLE: Record<string, { background: string; color: string }> = {
  vanilla: { background: "#56a85430", color: "#56a854" },
  fabric: { background: "#dcb23930", color: "#dcb239" },
  forge: { background: "#8a5a3830", color: "#c98554" },
  neoforge: { background: "#e8792530", color: "#e87925" },
};

const LOADERS: { id: "vanilla" | "fabric" | "forge" | "neoforge"; label: string; description: string; available: boolean }[] = [
  { id: "vanilla", label: "Vanilla", description: "Minecraft tal cual, sin mods.", available: true },
  { id: "fabric", label: "Fabric", description: "Ligero, ideal para la mayoría de mods modernos.", available: true },
  { id: "forge", label: "Forge", description: "El loader más veterano, con el catálogo de mods más grande.", available: true },
  { id: "neoforge", label: "NeoForge", description: "Continuación moderna de Forge.", available: true },
];

const STAGE_LABEL: Record<DownloadProgress["stage"], string> = {
  manifest: "Consultando versión…",
  client: "Descargando cliente…",
  libraries: "Descargando librerías…",
  assets: "Descargando assets…",
  java: "Instalando Java…",
  done: "Completado",
};

export default function Library() {
  const [view, setView] = useState<View>("grid");
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [search, setSearch] = useState("");
  const [pickedLoader, setPickedLoader] = useState<"vanilla" | "fabric" | "forge" | "neoforge">("vanilla");
  const [pickedVersion, setPickedVersion] = useState<string | null>(null);
  const [loaderVersions, setLoaderVersions] = useState<FabricLoaderVersion[] | null>(null);
  const [loaderVersionsError, setLoaderVersionsError] = useState<string | null>(null);
  const [pickedLoaderVersion, setPickedLoaderVersion] = useState<string | null>(null);
  const [name, setName] = useState("");

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadJavaMissing, setDownloadJavaMissing] = useState<{ instanceId: string; major: number } | null>(null);
  const [installingJava, setInstallingJava] = useState(false);

  const { isRunning, play, setActiveConsoleId } = useRunningInstances();

  async function refresh() {
    setInstances(await listInstances());
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
    const unlisten = onDownloadProgress((p) => setProgress(p));
    return () => { unlisten.then((f) => f()); };
  }, []);

  function openCreate() {
    setView("pick-loader");
    setSearch("");
    if (!versions) {
      getVersionManifest()
        .then((manifest) => setVersions(manifest.versions))
        .catch((err) => setDownloadError(String(err)));
    }
  }

  function pickLoader(loader: "vanilla" | "fabric" | "forge" | "neoforge") {
    setPickedLoader(loader);
    setView("pick-version");
  }

  function pickVersion(id: string) {
    setPickedVersion(id);
    const loaderLabel = LOADERS.find((l) => l.id === pickedLoader)?.label;
    setName(`Minecraft ${id}${pickedLoader !== "vanilla" ? ` (${loaderLabel})` : ""}`);

    if (pickedLoader !== "vanilla") {
      setLoaderVersions(null);
      setLoaderVersionsError(null);
      setPickedLoaderVersion(null);
      setView("pick-loader-version");

      const request =
        pickedLoader === "fabric"
          ? getFabricLoaderVersions(id)
          : getForgeVersions(pickedLoader, id).then((versions) => versions.map((v) => ({ version: v, stable: true })));

      request
        .then((versions) => {
          setLoaderVersions(versions);
          const latestStable = versions.find((v) => v.stable);
          setPickedLoaderVersion((latestStable ?? versions[0])?.version ?? null);
        })
        .catch((err) => setLoaderVersionsError(String(err)));
    } else {
      setView("name");
    }
  }

  async function handleCreate() {
    if (!pickedVersion) return;
    const instance = await createInstance(
      name.trim() || `Minecraft ${pickedVersion}`,
      pickedVersion,
      pickedLoader,
      pickedLoader !== "vanilla" ? pickedLoaderVersion : null
    );
    setView("grid");
    await refresh();
    handleDownload(instance);
  }

  async function handleDownload(instance: Instance) {
    setDownloadingId(instance.id);
    setDownloadError(null);
    setDownloadJavaMissing(null);
    setProgress(null);
    try {
      await downloadInstance(instance.id);
      await refresh();
    } catch (err) {
      const javaInfo = parseJavaMissing(String(err));
      if (javaInfo) {
        setDownloadJavaMissing({ instanceId: instance.id, major: javaInfo.major });
        setDownloadError(javaInfo.message);
      } else {
        setDownloadError(String(err));
      }
    } finally {
      setDownloadingId(null);
      setProgress(null);
    }
  }

  async function handleInstallJavaAndRetry(instance: Instance) {
    if (!downloadJavaMissing || downloadJavaMissing.instanceId !== instance.id) return;
    setInstallingJava(true);
    try {
      await installJava(downloadJavaMissing.major);
      setDownloadJavaMissing(null);
      await handleDownload(instance);
    } catch (err) {
      setDownloadError(String(err));
    } finally {
      setInstallingJava(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteInstance(id);
    await refresh();
  }

  const filteredVersions = (versions ?? []).filter(
    (v) => (showSnapshots || v.kind === "release") && v.id.toLowerCase().includes(search.toLowerCase())
  );

  if (!loaded) return null;

  return (
    <PageScene>
      <div className="library">
        {view !== "grid" && (
          <div className="library__breadcrumb">
            <button type="button" className="library__bc-link" onClick={() => setView("grid")}>
              Biblioteca
            </button>
            {view === "pick-loader" && (
              <><span>/</span><span className="library__bc-current">Elegir loader</span></>
            )}
            {view === "pick-version" && (
              <><span>/</span>
              <button type="button" className="library__bc-link" onClick={() => setView("pick-loader")}>
                {LOADERS.find((l) => l.id === pickedLoader)?.label}
              </button>
              <span>/</span><span className="library__bc-current">Elegir versión</span></>
            )}
            {view === "pick-loader-version" && (
              <><span>/</span>
              <button type="button" className="library__bc-link" onClick={() => setView("pick-version")}>
                {pickedVersion}
              </button>
              <span>/</span><span className="library__bc-current">Versión de {LOADERS.find((l) => l.id === pickedLoader)?.label}</span></>
            )}
            {view === "name" && (
              <><span>/</span>
              <button
                type="button"
                className="library__bc-link"
                onClick={() => setView(pickedLoader === "fabric" ? "pick-loader-version" : "pick-version")}
              >
                {pickedVersion}
              </button>
              <span>/</span><span className="library__bc-current">Nombre</span></>
            )}
          </div>
        )}

        <PageHeader
          eyebrow="Biblioteca"
          title="Tus instancias"
          subtitle="Crea y gestiona tus instancias de Minecraft."
          actions={
            view === "grid" && instances.length > 0 ? (
              <Button variant="primary" onClick={openCreate}>+ Nueva instancia</Button>
            ) : undefined
          }
        />
      {view === "grid" && (
        <GridView
          instances={instances}
          onNew={openCreate}
          onDownload={handleDownload}
          onPlay={play}
          onDelete={handleDelete}
          downloadingId={downloadingId}
          progress={progress}
          downloadError={downloadError}
          downloadJavaMissing={downloadJavaMissing}
          installingJava={installingJava}
          onInstallJavaAndRetry={handleInstallJavaAndRetry}
          isRunning={isRunning}
          onOpenConsole={setActiveConsoleId}
        />
      )}

      {view === "pick-loader" && (
        <div className="library__step">
          <p className="library__step-hint">¿Qué tipo de instancia quieres crear?</p>

          <div className="library__loaders">
            {LOADERS.map((l) => (
              <button
                key={l.id}
                type="button"
                className="library__loader-card"
                disabled={!l.available}
                onClick={() => l.available && pickLoader(l.id)}
              >
                <span className="library__loader-card-name">
                  {l.label}
                  {!l.available && <span className="library__loader-card-soon">Próximamente</span>}
                </span>
                <span className="library__loader-card-desc">{l.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {view === "pick-version" && (
        <div className="library__step">
          <p className="library__step-hint">
            Elige la versión de Minecraft para tu instancia de <strong>{LOADERS.find((l) => l.id === pickedLoader)?.label}</strong>.
          </p>

          <div className="library__search">
            <SearchIcon />
            <input
              type="text"
              placeholder="Filtrar versiones…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={showSnapshots} onChange={(e) => setShowSnapshots(e.target.checked)} />
            Mostrar snapshots
          </label>

          <div className="library__versions">
            {!versions && <p className="library__versions-empty">Cargando versiones de Mojang…</p>}
            {downloadError && !versions && <p className="library__versions-empty">{downloadError}</p>}
            {versions && filteredVersions.slice(0, 60).map((v) => (
              <button key={v.id} type="button" className="library__version-row" onClick={() => pickVersion(v.id)}>
                <span className="library__version-id">{v.id}</span>
                {v.kind !== "release" && <span className="library__version-tag">{v.kind}</span>}
                <ChevronIcon />
              </button>
            ))}
            {versions && filteredVersions.length === 0 && (
              <p className="library__versions-empty">No hay versiones que coincidan.</p>
            )}
          </div>
        </div>
      )}

      {view === "pick-loader-version" && (
        <div className="library__step">
          <p className="library__step-hint">
            Elige la versión de <strong>{LOADERS.find((l) => l.id === pickedLoader)?.label}</strong> para {pickedVersion}.
          </p>

          {!loaderVersions && !loaderVersionsError && (
            <p className="library__versions-empty">Consultando Fabric Meta…</p>
          )}
          {loaderVersionsError && (
            <p className="library__versions-empty">{loaderVersionsError}</p>
          )}

          {loaderVersions && (
            <>
              <div className="library__versions">
                {loaderVersions
                  .slice(0, 60)
                  .map((v) => (
                    <button
                      key={v.version}
                      type="button"
                      className={`library__version-row ${pickedLoaderVersion === v.version ? "library__version-row--active" : ""}`}
                      onClick={() => setPickedLoaderVersion(v.version)}
                    >
                      <span className="library__version-id">{v.version}</span>
                      {!v.stable && <span className="library__version-tag">beta</span>}
                      {pickedLoaderVersion === v.version && <span className="library__version-tag library__version-tag--active">elegida</span>}
                    </button>
                  ))}
              </div>

              <div className="library__config-actions">
                <Button variant="ghost" onClick={() => setView("pick-version")}>← Volver</Button>
                <Button variant="primary" onClick={() => setView("name")} disabled={!pickedLoaderVersion}>
                  Continuar
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {view === "name" && (
        <div className="library__step library__step--configure">
          <p className="library__step-hint">
            Ponle un nombre a tu instancia <strong>{pickedVersion}</strong>.
          </p>
          <div className="library__config-form">
            <label className="library__field">
              <span>Nombre de la instancia</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} autoFocus />
            </label>
            <div className="library__config-actions">
              <Button variant="ghost" onClick={() => setView("pick-version")}>← Volver</Button>
              <Button variant="primary" onClick={handleCreate} disabled={!name.trim()}>Crear instancia</Button>
            </div>
          </div>
        </div>
      )}

      </div>
    </PageScene>
  );
}

// ─── Grid de instancias ──────────────────────────────────────────────────────

function GridView({
  instances,
  onNew,
  onDownload,
  onPlay,
  onDelete,
  downloadingId,
  progress,
  downloadError,
  downloadJavaMissing,
  installingJava,
  onInstallJavaAndRetry,
  isRunning,
  onOpenConsole,
}: {
  instances: Instance[];
  onNew: () => void;
  onDownload: (i: Instance) => void;
  onPlay: (i: Instance) => void;
  onDelete: (id: string) => void;
  downloadingId: string | null;
  progress: DownloadProgress | null;
  downloadError: string | null;
  downloadJavaMissing: { instanceId: string; major: number } | null;
  installingJava: boolean;
  onInstallJavaAndRetry: (i: Instance) => void;
  isRunning: (id: string) => boolean;
  onOpenConsole: (id: string) => void;
}) {
  if (instances.length === 0) {
    return (
      <div className="library__empty">
        <div className="library__empty-icon"><LayersIconBig /></div>
        <h2>Sin instancias todavía</h2>
        <p>Crea tu primera instancia eligiendo una versión de Minecraft.</p>
        <Button variant="primary" onClick={onNew}>+ Nueva instancia</Button>
      </div>
    );
  }

  return (
    <div className="library__grid">
      {instances.map((inst) => {
        const isDownloading = downloadingId === inst.id;
        const playing = isRunning(inst.id);
        const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
        const javaMissingHere = downloadJavaMissing?.instanceId === inst.id ? downloadJavaMissing : null;

        return (
          <div key={inst.id} className="library__card">
            <div className="library__card-loader">
              <span className="library__badge" style={LOADER_BADGE_STYLE[inst.loader] ?? LOADER_BADGE_STYLE.vanilla}>
                {LOADER_LABEL[inst.loader] ?? "Vanilla"}
              </span>
            </div>
            <div className="library__card-info">
              <span className="library__card-name">{inst.name}</span>
              <span className="library__card-meta">{inst.versionId}</span>
            </div>

            {isDownloading && progress && (
              <div className="progress">
                <div className="progress__label">
                  <span>{STAGE_LABEL[progress.stage]}</span>
                  <span>{progress.total > 0 ? `${pct}%` : ""}</span>
                </div>
                <div className="progress__track">
                  <div className="progress__fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="progress__detail">{progress.detail}</span>
              </div>
            )}

            {!isDownloading && javaMissingHere && (
              <div className="library__java-prompt">
                <span>{downloadError}</span>
                {installingJava ? (
                  <span className="library__java-status">Instalando Java {javaMissingHere.major}…</span>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => onInstallJavaAndRetry(inst)}>
                    Instalar Java {javaMissingHere.major} automáticamente
                  </Button>
                )}
              </div>
            )}

            {!isDownloading && downloadError && !javaMissingHere && (
              <p className="library__versions-empty" style={{ padding: 0, fontSize: "var(--text-xs)" }}>{downloadError}</p>
            )}

            <div className="library__card-actions">
              {!inst.installed && !isDownloading && (
                <Button variant="primary" size="sm" onClick={() => onDownload(inst)} disabled={downloadingId !== null}>
                  ⬇ Descargar
                </Button>
              )}
              {inst.installed && !playing && (
                <Button variant="primary" size="sm" onClick={() => onPlay(inst)}>▶ Jugar</Button>
              )}
              {inst.installed && playing && (
                <Button variant="secondary" size="sm" onClick={() => onOpenConsole(inst.id)}>Jugando… ver consola</Button>
              )}
              {inst.installed && inst.loader !== "vanilla" && (
                <Link to={`/mods?instance=${inst.id}`} className="btn btn--ghost btn--sm">Mods</Link>
              )}
              {inst.installed && (
                <Button variant="ghost" size="sm" onClick={() => openInstanceFolder(inst.id)} title="Abrir carpeta de la instancia">
                  <FolderIcon />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => onDelete(inst.id)} disabled={isDownloading || playing}>✕</Button>
            </div>
          </div>
        );
      })}

      <button type="button" className="library__card-new" onClick={onNew}>
        <span className="library__card-new-icon">+</span>
        <span>Nueva instancia</span>
      </button>
    </div>
  );
}

// ─── Iconos ──────────────────────────────────────────────────────────────────

function LayersIconBig() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <path d="M12 4 4 8.5 12 13l8-4.5L12 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4 12.5 12 17l8-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16.5 12 21l8-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ marginLeft: "auto", opacity: 0.4 }}>
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
