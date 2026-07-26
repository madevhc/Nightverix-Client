import { useEffect, useState } from "react";
import { useTheme } from "../ThemeProvider";
import { ACCENT_PRESETS, type ThemeMode } from "../tokens";
import { getAppVersion } from "../tauri";
import { PageScene, PageHeader } from "../PageScene";
import "./Settings.css";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
  { value: "system", label: "Sistema" },
];

const PERFORMANCE_PROFILES = [
  { id: "laptop", label: "Portátil", description: "Prioriza autonomía y temperatura." },
  { id: "gaming", label: "Gaming", description: "Equilibrio entre FPS y estabilidad." },
  { id: "workstation", label: "Workstation", description: "Máximo rendimiento disponible." },
] as const;

export default function Settings() {
  const { mode, setMode, accentHue, setAccentHue } = useTheme();
  const isCustomAccent = !ACCENT_PRESETS.some((p) => p.hue === accentHue);
  const [customOpen, setCustomOpen] = useState(false);
  const [performanceProfile, setPerformanceProfile] =
    useState<(typeof PERFORMANCE_PROFILES)[number]["id"]>("gaming");
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  return (
    <PageScene>
    <div className="settings">
      <PageHeader
        eyebrow="Ajustes"
        title="Personaliza Nightverix"
        subtitle="Personaliza la apariencia y el comportamiento de Nightverix Client."
      />

      <section className="settings__section">
        <h2>Apariencia</h2>

        <div className="settings__row">
          <div>
            <span className="settings__row-label">Tema</span>
            <span className="settings__row-hint">Oscuro por defecto.</span>
          </div>
          <div className="settings__segmented" role="radiogroup" aria-label="Tema">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={mode === option.value}
                data-active={mode === option.value}
                onClick={() => setMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings__row">
          <div>
            <span className="settings__row-label">Color de acento</span>
            <span className="settings__row-hint">
              Un único color de acento en toda la interfaz.
            </span>
          </div>
          <div className="settings__accent-picker">
            <div className="settings__swatches" role="radiogroup" aria-label="Color de acento">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.hue}
                  type="button"
                  role="radio"
                  aria-checked={accentHue === preset.hue}
                  aria-label={preset.name}
                  title={preset.name}
                  data-active={accentHue === preset.hue}
                  className="settings__swatch"
                  style={{ ["--swatch-color" as string]: `hsl(${preset.hue} 100% 60%)` }}
                  onClick={() => setAccentHue(preset.hue)}
                />
              ))}

              <button
                type="button"
                role="radio"
                aria-checked={isCustomAccent}
                aria-label="Personalizado"
                title="Personalizado"
                data-active={isCustomAccent}
                className="settings__swatch settings__swatch--custom"
                onClick={() => setCustomOpen((v) => !v)}
              />
            </div>

            {(customOpen || isCustomAccent) && (
              <div className="settings__hue-slider">
                <input
                  type="range"
                  min={0}
                  max={359}
                  value={accentHue}
                  onChange={(e) => setAccentHue(Number(e.target.value))}
                  aria-label="Matiz del color de acento"
                />
                <span className="settings__hue-value">{accentHue}°</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="settings__section">
        <h2>Rendimiento</h2>
        <div className="settings__row">
          <div>
            <span className="settings__row-label">Perfil de rendimiento</span>
            <span className="settings__row-hint">
              Vista previa: aún no ajusta los flags de la JVM automáticamente.
            </span>
          </div>
          <div className="settings__segmented" role="radiogroup" aria-label="Perfil de rendimiento">
            {PERFORMANCE_PROFILES.map((profile) => (
              <button
                key={profile.id}
                type="button"
                role="radio"
                aria-checked={performanceProfile === profile.id}
                data-active={performanceProfile === profile.id}
                title={profile.description}
                onClick={() => setPerformanceProfile(profile.id)}
              >
                {profile.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings__section">
        <h2>Privacidad</h2>
        <div className="settings__row">
          <div>
            <span className="settings__row-label">Telemetría anónima</span>
            <span className="settings__row-hint">
              Desactivada por defecto. No se envía ningún dato todavía: este
              backend aún está por construir.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={telemetryEnabled}
            data-active={telemetryEnabled}
            className="settings__switch"
            onClick={() => setTelemetryEnabled((v) => !v)}
          >
            <span className="settings__switch-knob" />
          </button>
        </div>
      </section>

      <section className="settings__section">
        <h2>Acerca de</h2>
        <p className="settings__about">
          Nightverix Client {appVersion ? `v${appVersion}` : ""} — no es un
          producto oficial de Minecraft. No está aprobado por ni asociado con
          Mojang o Microsoft.
        </p>
      </section>
    </div>
    </PageScene>
  );
}
