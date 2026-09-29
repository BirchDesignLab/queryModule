/** A Playwright test annotation, the part the axe policy reads. */
export interface AxeAnnotation {
  type: string;
  description?: string | undefined;
}

/** Annotation type a test sets to skip the after-test axe run; its description is the reason. */
export const AXE_SKIP = "axe-skip";

/**
 * Whether the after-every-test axe run applies (spec 10.6: axe runs in every Playwright scenario
 * from M1). It does when the page is on the app origin, and not when the test opted out with an
 * `axe-skip` annotation. An opt-out must say why; one without a reason is an error, so a skip is
 * always reviewable.
 */
export function shouldRunAxe(
  pageUrl: string,
  annotations: readonly AxeAnnotation[],
  baseUrl: string,
): boolean {
  const skip = annotations.find((a) => a.type === AXE_SKIP);
  if (skip !== undefined) {
    if ((skip.description ?? "").trim() === "") {
      throw new Error(`${AXE_SKIP} needs a reason in its description`);
    }
    return false;
  }
  try {
    return new URL(pageUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
