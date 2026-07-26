import { Routes, Route } from "react-router-dom";

import { TitleBar } from "../TitleBar";
import { Sidebar } from "../Sidebar";
import { CommandPalette } from "../CommandPalette";
import { ConsolePanel } from "../ConsolePanel";

import Dashboard from "../routes/Dashboard";
import Library from "../routes/Library";
import Instances from "../routes/Instances";
import Console from "../routes/Console";
import Mods from "../routes/Mods";
import Account from "../routes/Account";
import Settings from "../routes/Settings";

import "./MainLayout.css";

export default function MainLayout() {
  return (
    <div className="main-layout">
      <TitleBar />
      <Sidebar />

      <main className="main-layout__content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/library" element={<Library />} />
          <Route path="/instances" element={<Instances />} />
          <Route path="/console" element={<Console />} />
          <Route path="/mods" element={<Mods />} />
          <Route path="/account" element={<Account />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* Cmd/Ctrl+K en cualquier pantalla — montado una sola vez aquí. */}
      <CommandPalette />

      {/* Consola de juego, visible sin importar en qué pantalla estés. */}
      <ConsolePanel />
    </div>
  );
}
