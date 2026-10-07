import type { Me } from '@ulysse/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createBrowserRouter, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ApiError, loginUrl, logout, useMe, useSelectTenant } from './api.ts';
import { BannerIcons, BrandMark, ChevronRight, LogoutIcon, NavIcons } from './components/icons.tsx';
import { ErrorBanner, Instrument, Loading } from './components/ui.tsx';
import { ROLE_LABELS } from './format.ts';
import type { Session } from './session.tsx';
import { can, SessionContext } from './session.tsx';
import { AdminPage } from './pages/Admin.tsx';
import { ConnectionsPage } from './pages/Connections.tsx';
import { HistoryPage } from './pages/History.tsx';
import { MeasurePage } from './pages/Measure.tsx';
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

function Wordmark() {
  return (
    <span className="brand">
      <BrandMark />
      <span className="brand-name">Ulysse</span>
    </span>
  );
}

function Landing() {
  const params = new URLSearchParams(useLocation().search);
  const error = params.get('login_error');
  return (
    <div className="landing">
      <header className="landing-top">
        <Wordmark />
      </header>
      <main id="main" className="landing-main">
        <div className="landing-copy">
          <h1>Des propositions commerciales prioritaires, expliquées et sourcées.</h1>
          <p className="lead">
            Ulysse les prépare en arrière-plan à partir de vos données autorisées. Vous décidez.
          </p>
          {error && (
            <div className="banner banner-error" role="alert">
              {BannerIcons.error}
              <div className="banner-body">{LOGIN_ERRORS[error] ?? 'La connexion a échoué.'}</div>
            </div>
          )}
          <div className="landing-actions">
            <a className="button button-primary button-lg" href={loginUrl('/recommendations')}>
              Se connecter
            </a>
            <p className="landing-note">
              Environnement de démonstration : données et doctrine fictives.
            </p>
          </div>
        </div>
        <Instrument className="instrument-hero" />
      </main>
    </div>
  );
}

function TenantPicker({ me }: { me: Me }) {
  const select = useSelectTenant();
  if (me.tenants.length === 0) {
    return (
      <div className="landing">
        <header className="landing-top">
          <Wordmark />
        </header>
        <main id="main" className="landing-main landing-narrow">
          <div className="landing-copy">
            <h1>Aucune entreprise active</h1>
            <p className="lead">
              Votre compte n&apos;est membre actif d&apos;aucune entreprise. Contactez le
              responsable de votre entreprise.
            </p>
            <LogoutButton />
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="landing">
      <header className="landing-top">
        <Wordmark />
      </header>
      <main id="main" className="landing-main landing-narrow">
        <div className="landing-copy">
          <h1>Choisissez une entreprise</h1>
          <p className="lead">Les données de chaque entreprise restent strictement séparées.</p>
          <ul className="tenant-list">
            {me.tenants.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="tenant-option"
                  disabled={select.isPending}
                  onClick={() => select.mutate(t.id)}
                >
                  <span className="tenant-option-name">{t.name}</span>{' '}
                  <span className="tenant-option-role">({ROLE_LABELS[t.role] ?? t.role})</span>
                  <ChevronRight />
                </button>
              </li>
            ))}
          </ul>
          {select.error && <ErrorBanner error={select.error} />}
        </div>
      </main>
    </div>
  );
}

function LogoutButton() {
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <button
        type="button"
        className="button button-ghost button-sm logout"
        onClick={() => void logout(client).catch(setError)}
      >
        <LogoutIcon />
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
    ...(can(session, 'analysis:read') ? [{ to: '/measure', label: 'Mesure' }] : []),
    ...(can(session, 'audit:read') ? [{ to: '/history', label: 'Historique' }] : []),
    { to: '/admin', label: 'Administration' },
  ];
  return (
    <SessionContext value={session}>
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <div className="shell">
        <header className="rail">
          <Wordmark />
          <nav aria-label="Navigation principale">
            <ul>
              {nav.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className="nav-link" viewTransition>
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="nav-indicator" aria-hidden="true" />}
                        {NavIcons[item.to]}
                        <span>{item.label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="account">
            <TenantSwitcher session={session} />
            <span className="account-user">
              {session.user.displayName} ·{' '}
              {ROLE_LABELS[session.activeTenant.role] ?? session.activeTenant.role}
            </span>
            <LogoutButton />
          </div>
        </header>
        <main id="main" tabIndex={-1} key={session.activeTenant.id}>
          <Outlet />
        </main>
      </div>
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
      { path: '/measure', element: <MeasurePage /> },
      { path: '/history', element: <HistoryPage /> },
      { path: '/admin', element: <AdminPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
