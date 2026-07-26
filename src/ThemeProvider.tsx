import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ACCENT_HUE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "./tokens";

interface ThemeContextValue {
  /** Preferencia guardada por el usuario: "light" | "dark" | "system". */
  mode: ThemeMode;
  /** Tema realmente aplicado al DOM, ya resuelto si mode === "system". */
  resolvedTheme: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  accentHue: number;
  setAccentHue: (hue: number) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "dark"; // Dark theme por defecto
}

function readStoredAccentHue(): number {
  if (typeof window === "undefined") return 234;
  const stored = window.localStorage.getItem(ACCENT_HUE_STORAGE_KEY);
  const parsed = stored ? Number(stored) : NaN;
  return Number.isFinite(parsed) ? parsed : 234;
}

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(
    getSystemPreference,
  );
  const [accentHue, setAccentHueState] = useState<number>(readStoredAccentHue);

  const resolvedTheme = mode === "system" ? systemTheme : mode;

  // Escuchar cambios de tema del sistema host
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? "dark" : "light");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  // Aplica el tema al doc
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  // Aplica el matiz de acento como variable CSS global.
  useEffect(() => {
    document.documentElement.style.setProperty("--accent-h", String(accentHue));
  }, [accentHue]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);

  const setAccentHue = useCallback((hue: number) => {
    setAccentHueState(hue);
    window.localStorage.setItem(ACCENT_HUE_STORAGE_KEY, String(hue));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedTheme, setMode, accentHue, setAccentHue }),
    [mode, resolvedTheme, setMode, accentHue, setAccentHue],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  }
  return ctx;
}
