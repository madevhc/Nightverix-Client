/**
 * Espejo tipado de los design tokens definidos en `styles/tokens.css`.
 * Útil cuando una animación o un cálculo de layout se controla desde
 * TypeScript (p. ej. duración de una transición orquestada con
 * `setTimeout`, o un breakpoint usado en un hook de tamaño de ventana).
 *
 * La fuente de verdad del valor visual sigue siendo el CSS; este
 * archivo solo debe contener los mismos números, no inventar otros.
 */

export const motion = {
  fast: 150,
  base: 200,
  slow: 250,
} as const;

export const easeStandard = "cubic-bezier(0.16, 1, 0.3, 1)";

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  full: 999,
} as const;

export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "nightverix:theme";
export const ACCENT_HUE_STORAGE_KEY = "nightverix:accent-hue";

/** Acentos sugeridos (matiz HSL) — el usuario puede elegir cualquiera. */
export const ACCENT_PRESETS = [
  { name: "Índigo", hue: 234 },
  { name: "Violeta", hue: 262 },
  { name: "Cian", hue: 189 },
  { name: "Verde menta", hue: 158 },
  { name: "Ámbar", hue: 38 },
] as const;
