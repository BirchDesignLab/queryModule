/**
 * The admin routes load their module graph lazily (routes.tsx). A test file's first render of
 * /admin would otherwise pay the cold module transform inside its first findBy window (1 s),
 * which timed out under full-suite load (Task 31 part 2 PR1 verify). Load it once in beforeAll.
 */
export async function preloadAdminRoutes(): Promise<void> {
  await import("../admin/AdminLayout.js");
}
