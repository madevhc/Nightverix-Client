# Nightverix Client

Launcher alternativo y open source para Minecraft Java Edition.

> Nightverix Client no es un producto oficial de Minecraft. No está aprobado
> por ni asociado con Mojang o Microsoft.

## Estructura del proyecto

```
nightverix-client/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/                    # Frontend (React + TypeScript)
│   ├── main.tsx
│   ├── App.tsx
│   ├── ThemeProvider.tsx   # Tema claro/oscuro/sistema + acento configurable
│   ├── tokens.css          # Design tokens (única fuente de verdad visual)
│   ├── tokens.ts           # Espejo tipado de los tokens, para usar en TS
│   ├── tauri.ts            # Bindings tipados hacia los comandos de Rust
│   ├── TitleBar.tsx         # Barra de título a medida (decorations: false)
│   ├── Sidebar.tsx          # Navegación principal
│   ├── CommandPalette.tsx   # Búsqueda universal (Cmd/Ctrl+K)
│   ├── Button.tsx / Card.tsx / EmptyState.tsx
│   ├── layout/
│   │   └── MainLayout.tsx   # Compone TitleBar + Sidebar + rutas + Command Palette
│   └── routes/
│       ├── Dashboard.tsx    # Inicio (incluye una tarjeta conectada de verdad a Rust)
│       ├── Library.tsx      # Catálogo para crear instancias (Vanilla/Fabric/Forge/NeoForge)
│       ├── Instances.tsx    # Instancias en ejecución
│       ├── Mods.tsx         # Búsqueda de mods (integración con Modrinth, próximamente)
│       └── Settings.tsx     # Tema, acento, perfil de rendimiento, telemetría
├── src-tauri/               # Backend (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       └── commands.rs      # get_system_info, get_app_version
├── brand/                   # Icono fuente de la marca (1024×1024)
└── scripts/generate_icon.py # Script que generó el icono a partir de los tokens
```
