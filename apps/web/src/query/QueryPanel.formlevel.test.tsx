import type { FormState } from "@querymodule/core/rules";
import { screen } from "@testing-library/react";
import { Outlet } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

vi.mock("@querymodule/core/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@querymodule/core/rules")>();
  return {
    ...actual,
    evaluateForm: (...args: Parameters<typeof actual.evaluateForm>): FormState => ({
      ...actual.evaluateForm(...args),
      valid: false,
      missingRequired: [],
      errors: [{ key: "validation.modeMismatch" }],
    }),
  };
});

describe("blocked submit with only a form-level error", () => {
  it("announces the message and a count that includes it, and describes the submit button", async () => {
    const services = testServices();
    services.authStore.getState().setSignedIn(TEST_USER);
    const { user } = renderRoutes(
      [
        {
          element: (
            <ClientSupportProvider clientSupported>
              <Outlet />
            </ClientSupportProvider>
          ),
          children: appRoutes(true),
        },
      ],
      { services },
    );
    await screen.findByLabelText("Plate");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    const polite = screen.getByTestId("announcer-polite");
    expect(polite).toHaveTextContent("1 field needs attention.");
    expect(polite).toHaveTextContent("The form changed while submitting.");
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAccessibleDescription(
      "The form changed while submitting. Check it and submit again.",
    );
  });
});
