import type { Me } from '@ulysse/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createBrowserRouter, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ApiError, loginUrl, logout, useMe, useSelectTenant } from './api.ts';
import { ErrorBanner, Loading } from './components/ui.tsx';
import { ROLE_LABELS } from './format.ts';
import type { Session } from './session.tsx';
import { can, SessionContext } from './session.tsx';
import { AdminPage } from './pages/Admin.tsx';
import { ConnectionsPage } from './pages/Connections.tsx';
import { HistoryPage } from './pages/History.tsx';
import { OpportunitiesPage } from './pages/Opportunities.tsx';
import { RecommendationDetailPage } from './pages/RecommendationDetail.tsx';
import { RecommendationsPage } from './pages/Recommendations.tsx';

const LOGIN_ERRORS: Record<string, string> = {
  denied: 'La connexion a été annulée.',
  expired: 'La tentative de connexion a expiré ou a déjà été utilisée. Recommencez.',
  invalid_token: "L'identité n'a pas pu être vérifiée.",
  not_provisioned:
    "Ce compte n'a pas accès à Ulysse. Demandez une invitation au responsable de votre entreprise.",
  disabled: 'Ce compte est désactivé.',
  invalid_request: 'Requête de connexion invalide.',
};

function Landing() {
  const params = new URLSearchParams(useLocation().search);
  const error = params.get('login_error');
  return (
    <main id="main" className="landing">
      <h1>Ulysse</h1>
      <p className="lead">
        Des propositions commerciales prioritaires, expliquées et sourcées, préparées en
        arrière-plan à partir de vos données autorisées. Vous décidez.
      </p>
      {error && (
        <div className="banner banner-error" role="alert">
          {LOGIN_ERRORS[error] ?? 'La connexion a échoué.'}
        </div>
      )}
      <a className="button button-primary" href={loginUrl('/recommendations')}>
        Se connecter
      </a>
      <p className="muted small">Environnement de démonstration : données et doctrine fictives.</p>
    </main>
  );
}

function TenantPicker({ me }: { me: Me }) {
  const select = useSelectTenant();
  if (me.tenants.length === 0) {
    return (
      <main id="main" className="landing">
        <h1>Aucune entreprise active</h1>
        <p>
          Votre compte n&apos;est membre actif d&apos;aucune entreprise. Contactez le responsable de
          votre entreprise.
        </p>
        <LogoutButton />
      </main>
    );
  }
  return (
    <main id="main" className="landing">
      <h1>Choisissez une entreprise</h1>
      <ul className="tenant-list">
        {me.tenants.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className="button"
              disabled={select.isPending}
              onClick={() => select.mutate(t.id)}
            >
              {t.name} <span className="muted">({ROLE_LABELS[t.role] ?? t.role})</span>
            </button>
          </li>
        ))}
      </ul>
      {select.error && <ErrorBanner error={select.error} />}
    </main>
  );
}

function LogoutButton() {
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <button
        type="button"
        className="button button-ghost"
        onClick={() => void logout(client).catch(setError)}
      >
        Se déconnecter
      </button>
      {error !== null && <ErrorBanner error={error} />}
    </>
  );
}

function TenantSwitcher({ session }: { session: Session }) {
  const select = useSelectTenant();
  if (session.tenants.length < 2)
    return <span className="tenant-name">{session.activeTenant.name}</span>;
  return (
    <label className="tenant-switch">
      <span className="visually-hidden">Entreprise active</span>
      <select
        value={session.activeTenant.id}
        disabled={select.isPending}
        onChange={(e) => select.mutate(e.target.value)}
      >
        {session.tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Layout() {
  const me = useMe();
  const location = useLocation();
  const firstRender = useRef(true);
  useEffect(() => {
    // Move focus to the content after client-side navigation (not on first load) for screen readers.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById('main')?.focus();
  }, [location.pathname]);
  if (me.isPending) return <Loading label="Vérification de la session…" />;
  if (me.error) return <ErrorBanner error={me.error} title="Session indisponible" />;
  if (!me.data) return <Navigate to="/" replace />;
  if (!me.data.activeTenant) return <TenantPicker me={me.data} />;
  const session = { ...me.data, activeTenant: me.data.activeTenant };
  const nav = [
    { to: '/recommendations', label: 'Propositions' },
    { to: '/opportunities', label: 'Opportunités' },
    { to: '/connections', label: 'Connexions' },
    ...(can(session, 'audit:read') ? [{ to: '/history', label: 'Historique' }] : []),
    { to: '/admin', label: 'Administration' },
  ];
  return (
    <SessionContext value={session}>
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <header className="topbar">
        <div className="brand">Ulysse</div>
        <nav aria-label="Navigation principale">
          <ul>
            {nav.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="account">
          <TenantSwitcher session={session} />
          <span className="muted small">
            {session.user.displayName} ·{' '}
            {ROLE_LABELS[session.activeTenant.role] ?? session.activeTenant.role}
          </span>
          <LogoutButton />
        </div>
      </header>
      <main id="main" tabIndex={-1} key={session.activeTenant.id}>
        <Outlet />
      </main>
    </SessionContext>
  );
}

function Home() {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.data) return <Navigate to="/recommendations" replace />;
  if (me.error && !(me.error instanceof ApiError && me.error.status === 401))
    return <ErrorBanner error={me.error} />;
  return <Landing />;
}

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  {
    element: <Layout />,
    children: [
      { path: '/recommendations', element: <RecommendationsPage /> },
      { path: '/recommendations/:id', element: <RecommendationDetailPage /> },
      { path: '/opportunities', element: <OpportunitiesPage /> },
      { path: '/connections', element: <ConnectionsPage /> },
      { path: '/history', element: <HistoryPage /> },
      { path: '/admin', element: <AdminPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
