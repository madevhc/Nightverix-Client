import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "./ThemeProvider";
import "./CommandPalette.css";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  perform: () => void;
}

/**
 * Paleta de comandos global, montada una única vez en `MainLayout`.
 * Se abre con Cmd/Ctrl+K desde cualquier pantalla de la app — el mismo
 * patrón de "búsqueda universal" que Raycast o la Command Palette de
 * Linear/Arc.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: "go-dashboard",
        label: "Ir a Inicio",
        hint: "Navegación",
        icon: <DotIcon />,
        perform: () => navigate("/"),
      },
      {
        id: "go-library",
        label: "Ir a Biblioteca",
        hint: "Navegación",
        icon: <DotIcon />,
        perform: () => navigate("/library"),
      },
      {
        id: "go-instances",
        label: "Ir a Instancias",
        hint: "Navegación",
        icon: <DotIcon />,
        perform: () => navigate("/instances"),
      },
      {
        id: "go-mods",
        label: "Ir a Mods",
        hint: "Navegación",
        icon: <DotIcon />,
        perform: () => navigate("/mods"),
      },
      {
        id: "go-settings",
        label: "Ir a Ajustes",
        hint: "Navegación",
        icon: <DotIcon />,
        perform: () => navigate("/settings"),
      },
      {
        id: "toggle-theme",
        label: mode === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro",
        hint: "Apariencia",
        icon: <DotIcon />,
        perform: () => setMode(mode === "dark" ? "light" : "dark"),
      },
    ],
    [navigate, mode, setMode],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Atajo global: Cmd/Ctrl+K abre, Escape cierra.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isToggle = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isToggle) {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  // Foco automático en el campo de búsqueda al abrir.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reinicia el índice activo cada vez que cambia el filtro.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function handleListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[activeIndex];
      if (command) {
        command.perform();
        close();
      }
    }
  }

  if (!open) return null;

  return (
    <div className="command-palette__backdrop" onMouseDown={close}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Búsqueda universal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleListKeyDown}
      >
        <div className="command-palette__search">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar instancias, mods, ajustes…"
            aria-label="Buscar"
          />
          <kbd>Esc</kbd>
        </div>

        <div className="command-palette__list" role="listbox">
          {filtered.length === 0 ? (
            <p className="command-palette__empty">No hay resultados.</p>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className="command-palette__item"
                data-active={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  command.perform();
                  close();
                }}
              >
                <span className="command-palette__item-icon">{command.icon}</span>
                <span>{command.label}</span>
                {command.hint ? (
                  <span className="command-palette__item-hint">{command.hint}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}
