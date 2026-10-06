import { type ClientPlatform, createTranslator } from "@querymodule/client";
import { createFakePlatform } from "@querymodule/client/testing";
import { LiveAnnouncer } from "@querymodule/web-ui";
import { type RenderResult, render } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import {
  createMemoryRouter,
  type DataRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { I18nProvider } from "../app/i18n-context.js";
import { createServices, type Services, type ServicesOptions } from "../app/services.js";
import { ServicesProvider } from "../app/services-context.js";
import { EN_BUNDLE } from "./en-bundle.js";
import { FakeSocket } from "./fake-socket.js";
import { API } from "./msw-server.js";

export function testPlatform(): ClientPlatform {
  return createFakePlatform();
}

export function testServices(options: Partial<ServicesOptions> = {}): Services {
  // Default to a socket that never opens, so a signed-in screen never reaches for the network.
  return createServices({
    baseUrl: API,
    platform: testPlatform(),
    createSocket: () => new FakeSocket(),
    ...options,
  });
}

/** Renders routes inside the providers the app uses, with the shipped English bundle. */
export function renderRoutes(
  routes: RouteObject[],
  options: { path?: string; services?: Services } = {},
): RenderResult & { services: Services; router: DataRouter; user: UserEvent } {
  const services = options.services ?? testServices();
  const router = createMemoryRouter(routes, { initialEntries: [options.path ?? "/"] });
  const user = userEvent.setup();
  const view = render(
    <ServicesProvider services={services}>
      <I18nProvider translator={createTranslator("en", EN_BUNDLE)}>
        <LiveAnnouncer announcer={services.announcer} />
        <RouterProvider router={router} />
      </I18nProvider>
    </ServicesProvider>,
  );
  return { ...view, services, router, user };
}
