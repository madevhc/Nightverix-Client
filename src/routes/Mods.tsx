import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageScene, PageHeader } from "../PageScene";
import {
  Instance,
  InstalledMod,
  installMod,
  listInstalledMods,
  listInstances,
  onModsChanged,
  removeMod,
} from "../tauri";
import "./Mods.css";

// ─── API Modrinth (pública, sin autenticación para lectura) ──────────────────
// Docs: https://docs.modrinth.com/api/

const MODRINTH_API = "https://api.modrinth.com/v2";

interface ModrinthProject {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  downloads: number;
  follows: number;
  icon_url: string | null;
  author: string;
  versions: string[];
  latest_version: string;
  date_modified: string;
  license: string;
  client_side: "required" | "optional" | "unsupported";
  server_side: "required" | "optional" | "unsupported";
}

interface SearchResult {
  hits: ModrinthProject[];
  total_hits: number;
  limit: number;
  offset: number;
}

interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  hashes: { sha1?: string };
}

interface ModrinthVersion {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthVersionFile[];
}

const MC_VERSIONS = ["Cualquier versión", "1.21.4", "1.21.1", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.16.5", "1.12.2"];
const LOADERS   = ["Cualquier loader", "fabric", "forge", "neoforge", "quilt"];
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "relevance", label: "Relevancia" },
  { value: "downloads",  label: "Descargas" },
  { value: "follows",    label: "Seguidos" },
  { value: "newest",     label: "Más nuevos" },
  { value: "updated",    label: "Actualizados" },
];

async function searchMods(
  query: string,
  loader: string,
  mcVersion: string,
  sortBy: string,
  offset = 0,
): Promise<SearchResult> {
  const facets: string[][] = [["project_type:mod"]];
  if (loader && loader !== "Cualquier loader") facets.push([`categories:${loader}`]);
  if (mcVersion && mcVersion !== "Cualquier versión") facets.push([`versions:${mcVersion}`]);

  const params = new URLSearchParams({
    query: query.trim(),
    facets: JSON.stringify(facets),
    index: sortBy,
    limit: "20",
    offset: String(offset),
  });

  const res = await fetch(`${MODRINTH_API}/search?${params}`);
  if (!res.ok) throw new Error(`Modrinth API ${res.status}`);
  return res.json() as Promise<SearchResult>;
}

/** Busca, entre las versiones de un mod, la mejor compatible con una
 * instancia concreta (mismo loader + misma versión de Minecraft). */
async function findBestVersionFile(
  projectId: string,
  gameVersion: string,
  loader: string
): Promise<{ file: ModrinthVersionFile; versionNumber: string } | null> {
  const params = new URLSearchParams({
    loaders: JSON.stringify([loader]),
    game_versions: JSON.stringify([gameVersion]),
  });
  const res = await fetch(`${MODRINTH_API}/project/${projectId}/version?${params}`);
  if (!res.ok) throw new Error(`Modrinth API ${res.status}`);
  const versions = (await res.json()) as ModrinthVersion[];
  if (versions.length === 0) return null;

  const best = versions[0];
  const file = best.files.find((f) => f.primary) ?? best.files[0];
  if (!file) return null;
  return { file, versionNumber: best.version_number };
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function Mods() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery]         = useState("");
  const [loader, setLoader]       = useState("fabric");
  const [mcVersion, setMcVersion] = useState("Cualquier versión");
  const [sortBy, setSortBy]       = useState("relevance");

  const [results, setResults]     = useState<ModrinthProject[]>([]);
  const [total, setTotal]         = useState(0);
  const [offset, setOffset]       = useState(0);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(searchParams.get("instance"));
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>([]);
  const [viewMode, setViewMode] = useState<"search" | "installed">("search");
  const [installedInfo, setInstalledInfo] = useState<Record<string, ModrinthProject>>({});
  const [removingFile, setRemovingFile] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moddableInstances = useMemo(() => instances.filter((i) => i.loader !== "vanilla" && i.installed), [instances]);
  const selectedInstance = moddableInstances.find((i) => i.id === selectedInstanceId) ?? null;

  useEffect(() => {
    listInstances().then((list) => {
      setInstances(list);
      const moddableOnes = list.filter((i) => i.loader !== "vanilla" && i.installed);
      if (!selectedInstanceId && moddableOnes.length > 0) {
        setSelectedInstanceId(moddableOnes[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (selectedInstance) {
      setMcVersion(selectedInstance.versionId);
      setLoader(selectedInstance.loader);
      setSearchParams({ instance: selectedInstance.id }, { replace: true });
      refreshInstalled(selectedInstance.id);
    } else {
      setInstalledMods([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstanceId, instances]);

  useEffect(() => {
    const unlisten = onModsChanged((instanceId) => {
      if (instanceId === selectedInstanceId) refreshInstalled(instanceId);
    });
    return () => { unlisten.then((f) => f()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstanceId]);

  async function refreshInstalled(instanceId: string) {
    setInstalledMods(await listInstalledMods(instanceId));
  }

  // Trae los datos (título, icono...) de Modrinth para los mods instalados
  // que tengan project_id guardado, en un único lote.
  useEffect(() => {
    const ids = [...new Set(installedMods.map((m) => m.projectId).filter((id): id is string => !!id))];
    const missing = ids.filter((id) => !installedInfo[id]);
    if (missing.length === 0) return;

    fetch(`${MODRINTH_API}/projects?ids=${encodeURIComponent(JSON.stringify(missing))}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Modrinth API ${res.status}`))))
      .then((projects: ModrinthProject[]) => {
        setInstalledInfo((prev) => {
          const next = { ...prev };
          for (const p of projects) next[p.project_id] = p;
          return next;
        });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installedMods]);

  async function handleRemoveInstalled(mod: InstalledMod) {
    if (!selectedInstance) return;
    setRemovingFile(mod.filename);
    try {
      await removeMod(selectedInstance.id, mod.filename);
      await refreshInstalled(selectedInstance.id);
    } finally {
      setRemovingFile(null);
    }
  }

  const doSearch = useCallback(
    async (q: string, ld: string, mv: string, sort: string, off = 0) => {
      setLoading(true);
      setError(null);
      setHasSearched(true);
      try {
        const data = await searchMods(q, ld, mv, sort, off);
        if (off === 0) {
          setResults(data.hits);
        } else {
          setResults((prev) => [...prev, ...data.hits]);
        }
        setTotal(data.total_hits);
        setOffset(off + data.hits.length);
      } catch (err) {
        setError("No se pudo conectar con Modrinth. Comprueba tu conexión a Internet.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Búsqueda inicial al montar (mods populares)
  useEffect(() => {
    void doSearch("", loader, mcVersion, sortBy, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cuando cambian los filtros, reinicia resultados
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOffset(0);
      void doSearch(query, loader, mcVersion, sortBy, 0);
    }, 380);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, loader, mcVersion, sortBy]);

  async function handleInstall(mod: ModrinthProject) {
    if (!selectedInstance) return;
    setInstallingId(mod.project_id);
    setInstallError(null);
    try {
      const best = await findBestVersionFile(mod.project_id, selectedInstance.versionId, selectedInstance.loader);
      if (!best) {
        setInstallError(`"${mod.title}" no tiene una versión compatible con ${selectedInstance.versionId} (Fabric).`);
        return;
      }
      await installMod(selectedInstance.id, best.file.url, best.file.filename, best.file.hashes.sha1 ?? null, mod.project_id);
      await refreshInstalled(selectedInstance.id);
    } catch (err) {
      setInstallError(String(err));
    } finally {
      setInstallingId(null);
    }
  }

  async function handleUninstall(mod: ModrinthProject) {
    if (!selectedInstance) return;
    const installedEntry = installedMods.find((m) => m.projectId === mod.project_id);
    if (!installedEntry) return;
    await removeMod(selectedInstance.id, installedEntry.filename);
    await refreshInstalled(selectedInstance.id);
  }

  const installedProjectIds = new Set(installedMods.map((m) => m.projectId).filter(Boolean));

  return (
    <PageScene>
      <div className="mods">
        {/* ── Cabecera ── */}
        <PageHeader
          eyebrow="Mods"
          title="Explora Modrinth"
          subtitle="Busca e instala mods directamente desde Modrinth."
          actions={total > 0 && !loading ? <span className="mods__total">{total.toLocaleString("es-ES")} resultados</span> : undefined}
        />

      {/* ── Selector de instancia ── */}
      <div className="mods__instance-picker">
        {moddableInstances.length === 0 ? (
          <p className="mods__instance-hint">
            No tienes ninguna instancia con mods (<strong>Fabric</strong>, <strong>Forge</strong> o <strong>NeoForge</strong>) lista todavía. Crea una desde la Biblioteca para poder instalar mods.
          </p>
        ) : (
          <>
            <span className="mods__instance-label">Instalar en:</span>
            <select value={selectedInstanceId ?? ""} onChange={(e) => setSelectedInstanceId(e.target.value)}>
              {moddableInstances.map((i) => (
                <option key={i.id} value={i.id}>{i.name} · {i.versionId} · {i.loader}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {installError && (
        <div className="mods__error">
          <span>⚠</span> {installError}
        </div>
      )}

      {selectedInstance && (
        <div className="mods__tabs">
          <button
            type="button"
            className={`mods__tab ${viewMode === "search" ? "mods__tab--active" : ""}`}
            onClick={() => setViewMode("search")}
          >
            Buscar
          </button>
          <button
            type="button"
            className={`mods__tab ${viewMode === "installed" ? "mods__tab--active" : ""}`}
            onClick={() => setViewMode("installed")}
          >
            Instalados {installedMods.length > 0 && `(${installedMods.length})`}
          </button>
        </div>
      )}

      {viewMode === "installed" && selectedInstance && (
        <div className="mods__installed-list">
          {installedMods.length === 0 && (
            <p className="mods__instance-hint">Todavía no has instalado ningún mod en esta instancia.</p>
          )}
          {installedMods.map((mod) => {
            const info = mod.projectId ? installedInfo[mod.projectId] : undefined;
            return (
              <div key={mod.filename} className="mods__installed-row">
                <div className="mods__installed-icon">
                  {info?.icon_url ? <img src={info.icon_url} alt="" width={36} height={36} /> : <DefaultModIcon />}
                </div>
                <div className="mods__installed-info">
                  <span className="mods__installed-title">{info?.title ?? mod.filename}</span>
                  <span className="mods__installed-meta">
                    {mod.filename} · {(mod.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>
                {info && (
                  <a href={`https://modrinth.com/mod/${info.slug}`} target="_blank" rel="noopener noreferrer" className="mods__installed-link">
                    Ver en Modrinth
                  </a>
                )}
                <button
                  type="button"
                  className="mods__installed-remove"
                  onClick={() => handleRemoveInstalled(mod)}
                  disabled={removingFile === mod.filename}
                >
                  {removingFile === mod.filename ? "Quitando…" : "Quitar"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === "search" && (
      <>
      {/* ── Barra de búsqueda + filtros ── */}
      <div className="mods__toolbar">
        <div className="mods__search">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar mods en Modrinth…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button type="button" className="mods__search-clear" onClick={() => setQuery("")}>
              ✕
            </button>
          )}
        </div>

        <div className="mods__filters">
          <select value={mcVersion} onChange={(e) => setMcVersion(e.target.value)}>
            {MC_VERSIONS.map((v) => <option key={v}>{v}</option>)}
          </select>
          <select value={loader} onChange={(e) => setLoader(e.target.value)}>
            {LOADERS.map((l) => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* ── Estados ── */}
      {error && (
        <div className="mods__error">
          <span>⚠</span> {error}
        </div>
      )}

      {loading && results.length === 0 && (
        <div className="mods__grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="mods__skeleton" />
          ))}
        </div>
      )}

      {!loading && hasSearched && results.length === 0 && !error && (
        <div className="mods__empty">
          <p>Sin resultados para "<strong>{query}</strong>".</p>
          <button type="button" onClick={() => setQuery("")}>Limpiar búsqueda</button>
        </div>
      )}

      {/* ── Grid de resultados ── */}
      {results.length > 0 && (
        <>
          <div className="mods__grid">
            {results.map((mod) => (
              <ModCard
                key={mod.project_id}
                mod={mod}
                installed={installedProjectIds.has(mod.project_id)}
                installing={installingId === mod.project_id}
                canInstall={!!selectedInstance}
                onInstall={() => handleInstall(mod)}
                onUninstall={() => handleUninstall(mod)}
              />
            ))}
          </div>

          {/* Cargar más */}
          {offset < total && (
            <div className="mods__load-more">
              <button
                type="button"
                disabled={loading}
                onClick={() => void doSearch(query, loader, mcVersion, sortBy, offset)}
              >
                {loading ? "Cargando…" : `Cargar más (${total - offset} restantes)`}
              </button>
            </div>
          )}
        </>
      )}
      </>
      )}
      </div>
    </PageScene>
  );
}

// ─── Tarjeta de mod ──────────────────────────────────────────────────────────

function ModCard({
  mod,
  installed,
  installing,
  canInstall,
  onInstall,
  onUninstall,
}: {
  mod: ModrinthProject;
  installed: boolean;
  installing: boolean;
  canInstall: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const downloadsFormatted = mod.downloads >= 1_000_000
    ? `${(mod.downloads / 1_000_000).toFixed(1)}M`
    : mod.downloads >= 1_000
    ? `${(mod.downloads / 1_000).toFixed(0)}K`
    : String(mod.downloads);

  const clientIcon =
    mod.client_side === "required" || mod.client_side === "optional" ? "💻" : null;
  const serverIcon =
    mod.server_side === "required" || mod.server_side === "optional" ? "🖥" : null;

  return (
    <div className={`mods__card ${installed ? "mods__card--installed" : ""}`}>
      {/* Icono */}
      <div className="mods__card-icon">
        {mod.icon_url ? (
          <img src={mod.icon_url} alt="" loading="lazy" width={44} height={44} />
        ) : (
          <DefaultModIcon />
        )}
      </div>

      {/* Info */}
      <div className="mods__card-info">
        <div className="mods__card-title-row">
          <a
            href={`https://modrinth.com/mod/${mod.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mods__card-title"
          >
            {mod.title}
          </a>
          <span className="mods__card-author">por {mod.author}</span>
        </div>

        <p className="mods__card-desc">{mod.description}</p>

        <div className="mods__card-meta">
          <span title="Descargas">⬇ {downloadsFormatted}</span>
          {clientIcon && <span title="Cliente">{clientIcon} Cliente</span>}
          {serverIcon && <span title="Servidor">{serverIcon} Servidor</span>}
          {mod.categories.slice(0, 3).map((cat) => (
            <span key={cat} className="mods__tag">{cat}</span>
          ))}
        </div>
      </div>

      {/* Acción */}
      <button
        type="button"
        className={`mods__card-btn ${installed ? "mods__card-btn--uninstall" : ""}`}
        onClick={installed ? onUninstall : onInstall}
        disabled={!canInstall || installing}
        title={!canInstall ? "Elige una instancia primero" : installed ? "Quitar mod" : "Instalar mod"}
      >
        {installing ? "Instalando…" : installed ? "✓ Instalado" : "+ Instalar"}
      </button>
    </div>
  );
}

// ─── Iconos ──────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function DefaultModIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
