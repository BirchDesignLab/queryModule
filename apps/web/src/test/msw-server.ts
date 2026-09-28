import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { EN_BUNDLE } from "./en-bundle.js";

export const API = "http://localhost:3000";
export const TEST_USER = { id: "user-0001", email: "tester@querymodule.test", role: "user" };
export const TEST_PASSWORD = "fixture-only-pass";
export const META = {
  apiVersion: "v1",
  coreVersion: "0.1.0",
  configSchemaVersion: 1,
  configHash: "0000000000000000000000000000000000000000000000000000000000000001",
  minClientVersion: null,
};

/** The contract shape of GET/PUT /api/v1/me/preferences (openapi.json getMePreferences200). */
export const PREFERENCES = {
  layout: { orientation: "horizontal", terminal: "toggle" },
  personaOverride: null,
  themeMode: "night",
} as const;

let signedIn = false;

export function resetMswState(): void {
  signedIn = false;
}

/** Stand-in for Track A P1 routes until they merge; shapes per spec 5.1 and Better Auth. */
export const server = setupServer(
  http.get(`${API}/api/v1/meta`, () => HttpResponse.json(META)),
  http.get(`${API}/api/v1/locales/en`, () => HttpResponse.json(EN_BUNDLE)),
  http.get(`${API}/api/v1/auth/get-session`, () =>
    HttpResponse.json(signedIn ? { session: { id: "s1" }, user: TEST_USER } : null),
  ),
  http.post(`${API}/api/v1/auth/sign-in/email`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === TEST_USER.email && body.password === TEST_PASSWORD) {
      signedIn = true;
      return HttpResponse.json({ redirect: false, token: "t", user: TEST_USER });
    }
    return HttpResponse.json(
      { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      { status: 401 },
    );
  }),
  http.post(`${API}/api/v1/auth/sign-out`, () => {
    signedIn = false;
    return HttpResponse.json({ success: true });
  }),
  http.get(`${API}/api/v1/me/preferences`, () => HttpResponse.json(PREFERENCES)),
  http.put(`${API}/api/v1/me/preferences`, async ({ request }) =>
    HttpResponse.json(await request.json()),
  ),
);
