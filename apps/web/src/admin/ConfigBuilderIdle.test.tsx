import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";

const validateDraftCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("./draft.js", async (importActual) => {
  const actual = await importActual<typeof import("./draft.js")>();
  return {
    ...actual,
    validateDraft: (...args: Parameters<typeof actual.validateDraft>) => {
      validateDraftCalls.count++;
      return actual.validateDraft(...args);
    },
  };
});

describe("config builder idle behaviour (Task 33 round 1, Q2/C1)", () => {
  it("does not re-run the draft checks while idle", async () => {
    const user = { ...TEST_USER, role: "implementer" };
    server.use(
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user }),
      ),
    );
    renderRoot({ path: "/admin/config" });
    await screen.findByRole("tab", { name: "Form" });
    await waitFor(() => expect(screen.getByTestId("draft-summary")).toHaveTextContent(/errors/));
    await new Promise((r) => setTimeout(r, 700));
    const settled = validateDraftCalls.count;
    expect(settled).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1000));
    expect(validateDraftCalls.count).toBe(settled);
  });
});
