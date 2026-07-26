import { useEffect, useRef, useState } from "react";
import { Button } from "../Button";
import { PageScene, PageHeader } from "../PageScene";
import {
  DeviceCodeInfo,
  PublicAccount,
  getActiveAccount,
  listAccounts,
  logoutAccount,
  openInBrowser,
  pollDeviceLogin,
  removeAccount as removeAccountApi,
  setActiveAccount,
  startDeviceLogin,
} from "../tauri";
import "./Account.css";

type LoginStage = "idle" | "device-code" | "verifying";

function skinBodyUrl(username: string) {
  return `https://mc-heads.net/body/${encodeURIComponent(username)}/300`;
}

function skinHeadUrl(username: string) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`;
}

export default function Account() {
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [active, setActive] = useState<PublicAccount | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [stage, setStage] = useState<LoginStage>("idle");
  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeInfo | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refresh() {
    const [list, activeAcc] = await Promise.all([listAccounts(), getActiveAccount()]);
    setAccounts(list);
    setActive(activeAcc);
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (expiryRef.current) clearTimeout(expiryRef.current);
    };
  }, []);

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (expiryRef.current) clearTimeout(expiryRef.current);
    pollRef.current = null;
    expiryRef.current = null;
  }

  async function startLogin() {
    setLoginError(null);
    try {
      const info = await startDeviceLogin();
      setDeviceInfo(info);
      setStage("device-code");

      void openInBrowser(info.verificationUriComplete ?? info.verificationUri);

      pollRef.current = setInterval(async () => {
        try {
          const result = await pollDeviceLogin(info.deviceCode);
          if (result.status === "pending") return;

          stopPolling();
          if (result.status === "success") {
            setStage("verifying");
            await refresh();
            setStage("idle");
          } else {
            setLoginError(result.message);
            setStage("idle");
          }
        } catch (err) {
          stopPolling();
          setLoginError(String(err));
          setStage("idle");
        }
      }, info.interval * 1000);

      expiryRef.current = setTimeout(() => {
        stopPolling();
        setLoginError("El código ha caducado. Inténtalo de nuevo.");
        setStage("idle");
      }, info.expiresIn * 1000);
    } catch (err) {
      setLoginError(String(err));
      setStage("idle");
    }
  }

  function cancelLogin() {
    stopPolling();
    setStage("idle");
  }

  async function handleLogout() {
    await logoutAccount();
    await refresh();
  }

  async function handleUse(id: string) {
    await setActiveAccount(id);
    await refresh();
  }

  async function handleRemove(id: string) {
    await removeAccountApi(id);
    await refresh();
  }

  if (!loaded) return null;

  // ── Flujo de login (device code real de Microsoft) ──────────────────────
  if (stage !== "idle") {
    return (
      <PageScene>
      <div className="account account--centered">
        <div className="login-flow">
          <div className="login-flow__icon">
            <MicrosoftIcon />
          </div>

          {stage === "device-code" && deviceInfo && (
            <>
              <h1>Vincula tu cuenta de Microsoft</h1>
              <p className="login-flow__desc">
                Ve a <strong>{deviceInfo.verificationUri.replace(/^https?:\/\//, "")}</strong>{" "}
                desde cualquier dispositivo e introduce este código.
              </p>

              <div className="login-flow__code">
                <span>{deviceInfo.userCode}</span>
                <button
                  type="button"
                  className="login-flow__copy"
                  onClick={() => void navigator.clipboard?.writeText(deviceInfo.userCode)}
                  title="Copiar código"
                >
                  <CopyIcon />
                </button>
              </div>

              <div className="login-flow__actions">
                <Button variant="ghost" onClick={cancelLogin}>Cancelar</Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void openInBrowser(deviceInfo.verificationUriComplete ?? deviceInfo.verificationUri)
                  }
                >
                  Abrir de nuevo
                </Button>
              </div>

              <p className="login-flow__hint">Esperando confirmación en Microsoft…</p>
            </>
          )}

          {stage === "verifying" && (
            <>
              <div className="login-flow__spinner" />
              <h1>Verificando tu cuenta…</h1>
              <p className="login-flow__desc">Cargando tu perfil y tu skin de Minecraft.</p>
            </>
          )}
        </div>
      </div>
      </PageScene>
    );
  }

  // ── Sin ninguna cuenta guardada ───────────────────────────────────────────
  if (accounts.length === 0) {
    return (
      <PageScene>
      <div className="account account--centered">
        <div className="account-hero">
          <div className="account-hero__icon">
            <MicrosoftIcon />
          </div>
          <h1>Inicia sesión</h1>
          <p>
            Conecta tu cuenta de Microsoft para jugar en servidores online, mostrar tu skin real
            y sincronizar tu perfil con Nightverix Client.
          </p>
          <Button variant="primary" size="md" onClick={startLogin} icon={<MicrosoftIcon small />}>
            Iniciar sesión con Microsoft
          </Button>
          <p className="account-hero__hint">
            Necesitas una cuenta de Minecraft: Java Edition vinculada a Microsoft.
          </p>
          {loginError && <p className="account-hero__error">{loginError}</p>}
        </div>
      </div>
      </PageScene>
    );
  }

  // ── Hay cuentas guardadas pero ninguna activa ────────────────────────────
  if (!active) {
    return (
      <PageScene>
      <div className="account">
        <PageHeader
          eyebrow="Cuenta"
          title="Elige una cuenta"
          subtitle="Elige una cuenta para continuar."
          actions={<Button variant="secondary" onClick={startLogin}>+ Añadir cuenta</Button>}
        />

        {loginError && <p className="account-hero__error">{loginError}</p>}

        <div className="account-switcher account-switcher--standalone">
          {accounts.map((acc) => (
            <AccountRow
              key={acc.id}
              account={acc}
              isActive={false}
              onUse={() => handleUse(acc.id)}
              onRemove={() => handleRemove(acc.id)}
            />
          ))}
        </div>
      </div>
      </PageScene>
    );
  }

  // ── Perfil con cuenta activa ─────────────────────────────────────────────
  return (
    <PageScene>
    <div className="account">
      <PageHeader
        eyebrow="Cuenta"
        title="Tu perfil"
        subtitle="Gestiona tu sesión y tus cuentas de Minecraft."
      />

      <div className="profile-card">
        <div className="profile-card__skin">
          <img src={skinBodyUrl(active.username)} alt={`Skin de ${active.username}`} loading="lazy" />
        </div>

        <div className="profile-card__info">
          <span className="profile-card__badge">
            <span className="profile-card__dot" /> Cuenta activa
          </span>
          <h2>{active.username}</h2>

          <button
            type="button"
            className="profile-card__uuid"
            onClick={() => void navigator.clipboard?.writeText(active.mcUuid)}
            title="Copiar UUID"
          >
            {active.mcUuid} <CopyIcon />
          </button>

          <div className="profile-card__meta">
            <span><MicrosoftIcon small /> Microsoft</span>
            <span>Java Edition</span>
          </div>

          <div className="profile-card__actions">
            <Button variant="secondary" disabled title="Próximamente">Cambiar skin</Button>
            <Button variant="ghost" onClick={handleLogout}>Cerrar sesión</Button>
          </div>
        </div>
      </div>

      <div className="account-switcher">
        <div className="account-switcher__header">
          <h2>Cuentas guardadas</h2>
          <Button size="sm" variant="secondary" onClick={startLogin}>+ Añadir cuenta</Button>
        </div>

        <div className="account-switcher__list">
          {accounts.map((acc) => (
            <AccountRow
              key={acc.id}
              account={acc}
              isActive={acc.id === active.id}
              onUse={() => handleUse(acc.id)}
              onRemove={() => handleRemove(acc.id)}
            />
          ))}
        </div>
      </div>
    </div>
    </PageScene>
  );
}

// ─── Fila de cuenta (selector multi-cuenta) ─────────────────────────────────

function AccountRow({
  account,
  isActive,
  onUse,
  onRemove,
}: {
  account: PublicAccount;
  isActive: boolean;
  onUse: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={`account-row ${isActive ? "account-row--active" : ""}`}>
      <img className="account-row__avatar" src={skinHeadUrl(account.username)} alt="" loading="lazy" />
      <div className="account-row__name">
        <span>{account.username}</span>
        <span className="account-row__uuid">{account.mcUuid}</span>
      </div>

      {isActive ? (
        <span className="account-row__tag">Activa</span>
      ) : (
        <Button size="sm" variant="secondary" onClick={onUse}>Usar</Button>
      )}

      <button type="button" className="account-row__remove" onClick={onRemove} title="Quitar cuenta">
        <TrashIcon />
      </button>
    </div>
  );
}

// ─── Iconos ──────────────────────────────────────────────────────────────────

function MicrosoftIcon({ small }: { small?: boolean }) {
  const size = small ? 14 : 30;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="2" y="2" width="9.4" height="9.4" fill="#f35325" />
      <rect x="12.6" y="2" width="9.4" height="9.4" fill="#81bc06" />
      <rect x="2" y="12.6" width="9.4" height="9.4" fill="#05a6f0" />
      <rect x="12.6" y="12.6" width="9.4" height="9.4" fill="#ffba08" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M5 7h14M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
