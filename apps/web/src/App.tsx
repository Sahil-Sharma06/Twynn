import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { Spinner } from './components/Spinner';
import { AppLayout } from './layouts/AppLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { RequireAuth } from './layouts/RequireAuth';
import { queryClient } from './lib/queries';

// Route-level code splitting: each page is its own chunk.
const Landing = lazy(() => import('./pages/landing/Landing').then((m) => ({ default: m.Landing })));
const Login = lazy(() => import('./pages/auth/Login').then((m) => ({ default: m.Login })));
const Signup = lazy(() => import('./pages/auth/Signup').then((m) => ({ default: m.Signup })));
const Onboarding = lazy(() =>
  import('./pages/onboarding/Onboarding').then((m) => ({ default: m.Onboarding })),
);
const Overview = lazy(() => import('./pages/app/Overview').then((m) => ({ default: m.Overview })));
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
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
