import { QueryClientProvider } from "@querymodule/client";
import { LiveAnnouncer } from "@querymodule/web-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserRouter, type RouteObject, RouterProvider } from "react-router";
import { AppChrome } from "./AppChrome.js";
import { type BootState, bootstrap } from "./bootstrap.js";
import { I18nProvider } from "./i18n-context.js";
import { appRoutes } from "./routes.js";
import type { Services } from "./services.js";
import { ServicesProvider, useServices } from "./services-context.js";

export type AppDataRouter = ReturnType<typeof createBrowserRouter>;
type CreateRouter = (routes: RouteObject[]) => AppDataRouter;

export interface RootProps {
  services: Services;
  clientVersion: string;
  createRouter?: CreateRouter;
}

function AppRouter({
  clientSupported,
  createRouter,
}: {
  clientSupported: boolean;
  createRouter: CreateRouter;
}) {
  const router = useMemo(
    () => createRouter(appRoutes(clientSupported)),
    [createRouter, clientSupported],
  );
  return <RouterProvider router={router} />;
}

function BootGate({
  clientVersion,
  createRouter,
  onRetry,
}: {
  clientVersion: string;
  createRouter: CreateRouter;
  onRetry(): void;
}) {
  const services = useServices();
  const [boot, setBoot] = useState<BootState | null>(null);
  useEffect(() => {
    let live = true;
    void bootstrap(services, clientVersion).then((state) => {
      if (live) setBoot(state);
    });
    return () => {
      live = false;
    };
  }, [services, clientVersion]);
  useEffect(() => {
    if (boot !== null) {
      document.title = boot.translator.t("app.title");
      document.documentElement.lang = boot.translator.locale;
    }
  }, [boot]);
  if (boot === null) return <main aria-busy="true" />;
  if (boot.status === "failed") {
    return (
      <BootFailed message={boot.message} retry={boot.translator.t("app.retry")} onRetry={onRetry} />
    );
  }
  return (
    <I18nProvider translator={boot.translator}>
      <AppRouter clientSupported={boot.clientSupported} createRouter={createRouter} />
    </I18nProvider>
  );
}

/**
 * Retry remounts BootGate, which removes the focused button; focusing the heading on mount keeps
 * focus off body and lets a screen reader hear that a retry failed again (spec 6.4, 10.6).
 */
function BootFailed({
  message,
  retry,
  onRetry,
}: {
  message: string;
  retry: string;
  onRetry(): void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <main className="qm-page">
      <h1 ref={headingRef} tabIndex={-1}>
        {message}
      </h1>
      <button type="button" className="qm-button" onClick={onRetry}>
        {retry}
      </button>
    </main>
  );
}

/** Live regions and theme exist from first render (spec 6.6, 6.5); routes wait for boot. */
export function Root({ services, clientVersion, createRouter = createBrowserRouter }: RootProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ServicesProvider services={services}>
      <QueryClientProvider client={services.queryClient}>
        <LiveAnnouncer announcer={services.announcer} />
        <AppChrome />
        <BootGate
          key={attempt}
          clientVersion={clientVersion}
          createRouter={createRouter}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      </QueryClientProvider>
    </ServicesProvider>
  );
}
