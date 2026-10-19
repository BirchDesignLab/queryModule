import { expect, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

/**
 * NFR-004, spec 6.7 and 4.7 (M2 P2): the client tells the server when it received a 202 with
 * `ackReceipt`, once per submitted query, over the open feed socket; the server counts the first
 * receipt (a metric, not audit) and the 202 carries `Server-Timing: ack`. The browser sees the
 * frame, the header and a socket that stays open; the counted metric is the server's log line
 * (covered by the API tests). Mock data only: plate ZZ-####.
 */

test.use({ emptyQueryList: true });

test("[NFR-004] one ackReceipt per 202, naming its correlation id; the socket stays open", async ({
  page,
}) => {
  const sent: { type?: string; correlationId?: string }[] = [];
  let closeCode: number | undefined;
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      try {
        sent.push(JSON.parse(String(frame.payload)) as { type?: string });
      } catch {
        // A non-JSON frame is not one of ours.
      }
    });
    ws.on("close", () => {
      closeCode = -1;
    });
  });

  await signIn(page);
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  const field = page.getByLabel("Plate", { exact: true });
  await field.fill("ZZ-0031");
  const accepted = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
  );
  await field.press("Enter");
  const response = await accepted;
  expect(response.status()).toBe(202);
  expect(response.headers()["server-timing"]).toMatch(
    /^ack;dur=\d+(\.\d+)?;desc="receipt to commit"$/,
  );
  const { correlationId } = (await response.json()) as { correlationId: string };

  await expect
    .poll(() => sent.filter((m) => m.type === "ackReceipt").map((m) => m.correlationId))
    .toEqual([correlationId]);
  // The server accepted it: the socket was not closed for a bad frame or the rate limit.
  await page.waitForTimeout(500);
  expect(closeCode).toBeUndefined();
});
