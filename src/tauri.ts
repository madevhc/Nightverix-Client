import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";

/**
 * Información del sistema que expone el backend de Rust.
 * Coincide con el struct `SystemInfo` definido en `src-tauri/src/commands.rs`.
 */
export interface SystemInfo {
  os: string;
  arch: string;
  appVersion: string;
  cpuCores: number;
  totalMemoryMb: number;
}

/** Llama al comando Rust `get_system_info`. */
export async function getSystemInfo(): Promise<SystemInfo> {
  return invoke<SystemInfo>("get_system_info");
}

/** Llama al comando Rust `get_app_version`. */
export async function getAppVersion(): Promise<string> {
  return invoke<string>("get_app_version");
}

/** Controles de la ventana principal, usados por el TitleBar a medida. */
export const windowControls = {
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
  startDragging: () => getCurrentWindow().startDragging(),
};

// ─── Autenticación real con Microsoft (ver src-tauri/src/auth.rs) ──────────

export interface DeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresIn: number;
  interval: number;
}

/** Abre una URL en el navegador por defecto del sistema (no un iframe/webview interno). */
export async function openInBrowser(url: string): Promise<void> {
  await openUrl(url);
}

export interface PublicAccount {
  id: string;
  mcUuid: string;
  username: string;
}

export type LoginPollResult =
  | { status: "pending" }
  | { status: "success"; account: PublicAccount }
  | { status: "error"; message: string };

/** Inicia el flujo de "device code" con Microsoft. */
export async function startDeviceLogin(): Promise<DeviceCodeInfo> {
  return invoke<DeviceCodeInfo>("start_device_login");
}

/** Pregunta a Microsoft si el usuario ya autorizó el código. Llamar cada `interval` segundos. */
export async function pollDeviceLogin(deviceCode: string): Promise<LoginPollResult> {
  return invoke<LoginPollResult>("poll_device_login", { deviceCode });
}

export async function listAccounts(): Promise<PublicAccount[]> {
  return invoke<PublicAccount[]>("list_accounts");
}

export async function getActiveAccount(): Promise<PublicAccount | null> {
  return invoke<PublicAccount | null>("get_active_account");
}

export async function setActiveAccount(id: string): Promise<void> {
  return invoke<void>("set_active_account", { id });
}

export async function removeAccount(id: string): Promise<void> {
  return invoke<void>("remove_account", { id });
}

export async function logoutAccount(): Promise<void> {
  return invoke<void>("logout_account");
}

// ─── Instancias y lanzado del juego (ver src-tauri/src/instances.rs y launcher.rs) ─

export interface Instance {
  id: string;
  name: string;
  versionId: string;
  loader: string;
  loaderVersion: string | null;
  createdAt: number;
  installed: boolean;
}

export interface VersionSummary {
  id: string;
  kind: string;
  releaseTime: string;
}

export interface VersionManifestSummary {
  latestRelease: string;
  latestSnapshot: string;
  versions: VersionSummary[];
}

export interface DownloadProgress {
  stage: "manifest" | "client" | "libraries" | "assets" | "java" | "done";
  current: number;
  total: number;
  detail: string;
}

export async function listInstances(): Promise<Instance[]> {
  return invoke<Instance[]>("list_instances");
}

export async function createInstance(
  name: string,
  versionId: string,
  loader: "vanilla" | "fabric" | "forge" | "neoforge" = "vanilla",
  loaderVersion: string | null = null
): Promise<Instance> {
  return invoke<Instance>("create_instance", { name, versionId, loader, loaderVersion });
}

export interface FabricLoaderVersion {
  version: string;
  stable: boolean;
}

export async function getFabricLoaderVersions(gameVersion: string): Promise<FabricLoaderVersion[]> {
  return invoke<FabricLoaderVersion[]>("get_fabric_loader_versions", { gameVersion });
}

export async function getForgeVersions(flavor: "forge" | "neoforge", gameVersion: string): Promise<string[]> {
  return invoke<string[]>("get_forge_versions", { flavor, gameVersion });
}

export async function deleteInstance(id: string): Promise<void> {
  return invoke<void>("delete_instance", { id });
}

/** Abre la carpeta de la instancia (mundo, mods, config...) en el explorador del sistema. */
export async function openInstanceFolder(instanceId: string): Promise<void> {
  return invoke<void>("open_instance_folder", { instanceId });
}

export async function getVersionManifest(): Promise<VersionManifestSummary> {
  return invoke<VersionManifestSummary>("get_version_manifest");
}

/** Descarga todo lo necesario para jugar una instancia. Escucha `onDownloadProgress` para la barra de progreso. */
export async function downloadInstance(instanceId: string): Promise<void> {
  return invoke<void>("download_instance", { instanceId });
}

/** Lanza el proceso de Java. Escucha `onGameLog` y `onGameExit` para la consola. */
export async function launchInstance(instanceId: string): Promise<void> {
  return invoke<void>("launch_instance", { instanceId });
}

/**
 * Cuando `launch_instance` (o el instalador de Forge/NeoForge) no encuentra
 * un Java que le sirva a la versión de Minecraft elegida, el error viene
 * con el marcador "JAVA_MISSING:<major>::<mensaje>" — ver
 * `launcher::find_java` en el backend. `parseJavaMissing` lo detecta para
 * poder ofrecer el botón de instalar; `stripJavaMissingMarker` es para
 * sitios que solo quieren mostrar el mensaje como texto plano, sin botón.
 */
export interface JavaMissingInfo {
  major: number;
  message: string;
}

const JAVA_MISSING_RE = /^JAVA_MISSING:(\d+)::([\s\S]*)$/;

export function parseJavaMissing(raw: string): JavaMissingInfo | null {
  const match = raw.match(JAVA_MISSING_RE);
  return match ? { major: Number(match[1]), message: match[2] } : null;
}

export function stripJavaMissingMarker(raw: string): string {
  return raw.match(JAVA_MISSING_RE)?.[2] ?? raw;
}

/** Descarga e instala un JRE de Temurin automáticamente (ver java_runtime.rs). Escucha `onDownloadProgress` (stage "java") para el progreso. */
export async function installJava(majorVersion: number): Promise<void> {
  return invoke<void>("install_java", { majorVersion });
}

export interface RunningInstanceInfo {
  instanceId: string;
  versionId: string;
  pid: number;
  startedAt: number;
}

export interface InstanceStats {
  memoryMb: number;
  cpuPercent: number;
  gpuPercent: number | null;
  gpuMemoryMb: number | null;
}

export async function listRunningInstances(): Promise<RunningInstanceInfo[]> {
  return invoke<RunningInstanceInfo[]>("list_running_instances");
}

export async function getInstanceStats(instanceId: string): Promise<InstanceStats> {
  return invoke<InstanceStats>("get_instance_stats", { instanceId });
}

export function onDownloadProgress(callback: (progress: DownloadProgress) => void) {
  return listen<DownloadProgress>("download-progress", (event) => callback(event.payload));
}

export function onGameLog(callback: (payload: { instanceId: string; line: string }) => void) {
  return listen<{ instanceId: string; line: string }>("game-log", (event) => callback(event.payload));
}

export function onGameExit(callback: (info: { instanceId: string; code: number }) => void) {
  return listen<{ instanceId: string; code: number }>("game-exit", (event) => callback(event.payload));
}

export function onInstancesChanged(callback: () => void) {
  return listen<void>("instances-changed", () => callback());
}

// ─── Mods instalados por instancia (ver src-tauri/src/mods.rs) ─────────────

export interface InstalledMod {
  filename: string;
  sizeBytes: number;
  projectId: string | null;
}

export async function listInstalledMods(instanceId: string): Promise<InstalledMod[]> {
  return invoke<InstalledMod[]>("list_installed_mods", { instanceId });
}

export async function installMod(
  instanceId: string,
  downloadUrl: string,
  filename: string,
  sha1: string | null,
  projectId: string | null
): Promise<void> {
  return invoke<void>("install_mod", { instanceId, downloadUrl, filename, sha1, projectId });
}

export async function removeMod(instanceId: string, filename: string): Promise<void> {
  return invoke<void>("remove_mod", { instanceId, filename });
}

export function onModsChanged(callback: (instanceId: string) => void) {
  return listen<string>("mods-changed", (event) => callback(event.payload));
}
