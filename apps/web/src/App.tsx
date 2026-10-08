import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { Spinner } from './components/Spinner';
import { AppLayout } from './layouts/AppLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { RequireAuth } from './layouts/RequireAuth';
import { ToastProvider } from './components/Toast';
import { queryClient } from './lib/queries';

// Route-level code splitting: each page is its own chunk.
const Landing = lazy(() => import('./pages/landing/Landing').then((m) => ({ default: m.Landing })));
const Login = lazy(() => import('./pages/auth/Login').then((m) => ({ default: m.Login })));
const Signup = lazy(() => import('./pages/auth/Signup').then((m) => ({ default: m.Signup })));
const Onboarding = lazy(() =>
  import('./pages/onboarding/Onboarding').then((m) => ({ default: m.Onboarding })),
);
const Overview = lazy(() => import('./pages/app/Overview').then((m) => ({ default: m.Overview })));
const Requests = lazy(() => import('./pages/app/Requests').then((m) => ({ default: m.Requests })));
const RequestDetail = lazy(() =>
  import('./pages/app/RequestDetail').then((m) => ({ default: m.RequestDetail })),
);
const Cache = lazy(() => import('./pages/app/Cache').then((m) => ({ default: m.Cache })));
const Keys = lazy(() => import('./pages/app/Keys').then((m) => ({ default: m.Keys })));
const Settings = lazy(() => import('./pages/app/Settings').then((m) => ({ default: m.Settings })));
const Playground = lazy(() =>
  import('./pages/app/Playground').then((m) => ({ default: m.Playground })),
);
const Evaluate = lazy(() => import('./pages/app/Evaluate').then((m) => ({ default: m.Evaluate })));
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })));

const page = (node: ReactNode) => (
  <Suspense
    fallback={
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '40dvh' }}>
        <Spinner size={22} label="Loading" />
      </div>
    }
  >
    {node}
  </Suspense>
);

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: page(<Landing />) },
      { path: '*', element: page(<NotFound />) },
    ],
  },
  { path: '/login', element: page(<Login />) },
  // Development-only component catalogue; the branch is removed from production builds.
  ...(import.meta.env.DEV
    ? [
        {
          path: '/dev/components',
          Component: lazy(() =>
            import('./pages/dev/DevComponents').then((m) => ({ default: m.DevComponents })),
          ),
        },
      ]
    : []),
  { path: '/signup', element: page(<Signup />) },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { path: '/onboarding', element: page(<Onboarding />) },
      { path: '/app', element: page(<Overview />) },
      { path: '/app/requests', element: page(<Requests />) },
      { path: '/app/requests/:id', element: page(<RequestDetail />) },
      { path: '/app/playground', element: page(<Playground />) },
      { path: '/app/cache', element: page(<Cache />) },
      { path: '/app/keys', element: page(<Keys />) },
      { path: '/app/settings', element: page(<Settings />) },
      { path: '/app/evaluate', element: page(<Evaluate />) },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
