# Nightverix Client

Launcher alternativo y open source para Minecraft Java Edition.

> Nightverix Client no es un producto oficial de Minecraft. No está aprobado
> por ni asociado con Mojang o Microsoft.

## Requisitos

- [Node.js](https://nodejs.org) 18 o superior
- [Rust](https://www.rust-lang.org/tools/install) instalado vía **rustup**,
  canal `stable` (versión **1.77.2 o superior** — es el mínimo que exige
  Tauri 2.11; en la práctica, cualquier instalación reciente de rustup ya
  cumple esto de sobra).
- En Linux, las librerías de desarrollo de WebKitGTK. En Debian/Ubuntu:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
    libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev \
    build-essential pkg-config libssl-dev
  ```
  En Windows y macOS no hace falta nada adicional aparte de rustup.

## Puesta en marcha

```bash
npm install
npm run tauri dev
```

Esto compila el backend de Rust y abre la ventana de la app con recarga en
caliente del frontend.

## Build de producción

```bash
npm run tauri build
```

Genera el instalador para tu plataforma (`.msi`/`.exe` en Windows, `.dmg`/
`.app` en macOS, `.deb`/`.AppImage` en Linux) dentro de
`src-tauri/target/release/bundle/`.

## Si alguna vez ves una pantalla en blanco

Casi siempre es la **caché de dependencias de Vite**, que queda obsoleta
cuando cambia la estructura de archivos del proyecto (justo lo que pasó al
mover/reorganizar componentes). La solución es borrar la caché y reinstalar:

```bash
rm -rf node_modules dist src-tauri/target
npm install
npm run tauri dev
```

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

## Estado actual

- ✅ Frontend: compila sin errores (`tsc -b && vite build`), tema
  claro/oscuro/sistema, acento configurable, 5 pantallas, Command Palette
  funcional, conexión real al backend de Rust para mostrar info del sistema.
- ✅ Backend: comandos `get_system_info` y `get_app_version` reales,
  permisos de ventana (`capabilities/default.json`) configurados para la
  TitleBar a medida.
- 🚧 Pendiente (siguientes pasos naturales): autenticación con Microsoft,
  instalación automática de Fabric/Forge/NeoForge, integración real con la
  API de Modrinth, perfiles de rendimiento conectados a flags de la JVM.
