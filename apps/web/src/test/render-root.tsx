import type { SocketLike } from "@querymodule/client";
import { type RenderResult, render } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { Root } from "../app/Root.js";
import type { Services } from "../app/services.js";
import { testServices } from "./render-routes.js";

export function renderRoot(
  options: { path?: string; createSocket?: (url: string) => SocketLike } = {},
): RenderResult & { services: Services; user: UserEvent } {
  const services = testServices(
    options.createSocket === undefined ? {} : { createSocket: options.createSocket },
  );
  const user = userEvent.setup();
  const view = render(
    <Root
      services={services}
      clientVersion="0.1.0"
      createRouter={(routes) =>
        createMemoryRouter(routes, { initialEntries: [options.path ?? "/"] })
      }
    />,
  );
  return { ...view, services, user };
}
