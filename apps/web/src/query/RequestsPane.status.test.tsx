import type { RequestsState, SubmitQueryResponse } from "@querymodule/client";
import { shortReference } from "@querymodule/web-ui";
import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ACK_CORRELATION_ID, FeedDriver } from "../test/feed-driver.js";
import { CLIENT_CONFIG, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";
import { RequestsPane } from "./RequestsPane.js";

const ACK: SubmitQueryResponse = {
  correlationId: ACK_CORRELATION_ID,
  acknowledgedAt: Date.UTC(2026, 8, 29, 17, 4, 5),
  parts: [
    {
      partId: 1,
      parentPartId: null,
      origin: "primary",
      queryType: "VEH",
      status: "dispatched",
      sourceIds: ["stateSource", "nationalSource"],
      droppedSourceIds: [],
      skipReasons: [],
    },
  ],
};

function setup(
  response = ACK,
  begin: Parameters<RequestsState["begin"]>[0] = {
    queryType: "VEH",
    summary: "VEH.ZZ-0001",
    submitted: { queryType: "VEH", values: { plate: "ZZ-0001" }, sourceIds: [], mode: "normal" },
  },
) {
  const driver = new FeedDriver();
  const services = testServices({ createSocket: driver.createSocket });
  services.authStore.getState().setSignedIn(TEST_USER);
  const id = services.requests.getState().begin(begin);
  act(() => {
    services.requests.getState().settle(id, { kind: "acknowledged", response, queryType: "VEH" });
  });
  const view = renderRoutes(
    [
      {
        path: "/",
        element: (
          <>
            <input aria-label="Plate" />
            <RequestsPane config={CLIENT_CONFIG} variant="list" />
          </>
        ),
      },
    ],
    { services },
  );
  return { ...view, driver };
}

const sourceList = () => screen.getByRole("group", { name: /Source status for Vehicle ZZ-0001/ });

describe("FR-043 the requests list shows per-source status (spec 6.2, 6.6)", () => {
  it("after an acknowledgment each source line reads pending, in words", () => {
    setup();
    const list = sourceList();
    expect(within(list).getByText("State system: pending")).toBeInTheDocument();
    expect(within(list).getByText("National system: pending")).toBeInTheDocument();
  });

  it("an event turns one line into its new status in place while focus and the typed value stay", async () => {
    const { driver, services, user } = setup();
    services.feed.open();
    await user.click(screen.getByLabelText("Plate"));
    await user.keyboard("ABC");
    const line = within(sourceList()).getByText("State system: pending").closest(".qm-source");
    const row = line?.closest("li.qm-request");
    act(() => driver.status("stateSource", "failed"));
    const after = within(sourceList()).getByText("State system: failed").closest(".qm-source");
    expect(after).toBe(line);
    expect(within(sourceList()).getByText("National system: pending")).toBeInTheDocument();
    expect(after?.closest("li.qm-request")).toBe(row);
    expect(screen.getByLabelText("Plate")).toHaveFocus();
    expect(screen.getByLabelText("Plate")).toHaveValue("ABC");
    services.feed.close();
  });

  it("G6: a source that returned shows a loading line, not returned, until its card arrives", () => {
    const { driver, services } = setup();
    services.feed.open();
    act(() => driver.status("stateSource", "returned"));
    const list = sourceList();
    expect(within(list).getByText("State system: loading result")).toBeInTheDocument();
    expect(within(list).queryByText("State system: returned")).not.toBeInTheDocument();
    services.feed.close();
  });

  it("G5: a failed, timed out or interrupted line says why, in words", () => {
    const { driver, services } = setup();
    services.feed.open();
    act(() => driver.status("stateSource", "failed"));
    act(() => driver.status("nationalSource", "timedOut"));
    const list = sourceList();
    expect(within(list).getByText("the source reported an error")).toBeInTheDocument();
    expect(within(list).getByText("no answer in 10 s")).toBeInTheDocument();
    services.feed.close();
  });

  it("#650 a status this app does not know shows as unknown, in words, with a neutral mark", () => {
    const { driver, services } = setup();
    services.feed.open();
    act(() => driver.status("stateSource", "someLaterStatus"));
    const list = sourceList();
    const line = within(list).getByText("State system: unknown").closest(".qm-source");
    expect(line).toHaveClass("qm-source--unknown");
    expect(
      within(list).getByText("this version of the app does not know this status"),
    ).toBeInTheDocument();
    expect(within(list).queryByText(/someLaterStatus/)).not.toBeInTheDocument();
    services.feed.close();
  });

  it("a focused control inside the row keeps focus when an event arrives", async () => {
    const { driver, services, user } = setup();
    services.feed.open();
    const copy = screen.getByRole("button", { name: /^Copy reference/ });
    await user.click(copy);
    copy.focus();
    act(() => driver.status("nationalSource", "timedOut"));
    expect(within(sourceList()).getByText("National system: timed out")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Copy reference/ })).toBe(copy);
    expect(copy).toHaveFocus();
    services.feed.close();
  });

  it("a nested part is labelled with its origin and a skipped part says skipped", () => {
    setup({
      ...ACK,
      parts: [
        ...ACK.parts,
        {
          partId: 2,
          parentPartId: 0,
          origin: "alsoRun",
          queryType: "WNT",
          status: "dispatched",
          sourceIds: ["nationalSource"],
          droppedSourceIds: [],
          skipReasons: [],
        },
        {
          partId: 3,
          parentPartId: 0,
          origin: "alsoRun",
          queryType: "PRO",
          status: "skipped",
          sourceIds: [],
          droppedSourceIds: [],
          skipReasons: [{ key: "validation.required", params: { field: "dob" } }],
        },
      ],
    });
    expect(screen.getByText("Wanted check, also run from Vehicle")).toBeInTheDocument();
    expect(screen.getByText("Property not run: needs dob.")).toBeInTheDocument();
    expect(within(sourceList()).getAllByText("National system: pending")).toHaveLength(2);
  });

  it("#587 a plate-only request shows the dropped source as its own line, in words", () => {
    setup({
      ...ACK,
      parts: [
        { ...ACK.parts[0], sourceIds: ["stateSource"], droppedSourceIds: ["nationalSource"] },
      ],
    } as SubmitQueryResponse);
    const list = sourceList();
    expect(within(list).getByText("State system: pending")).toBeInTheDocument();
    expect(within(list).getByText("National system: not run (plate only)")).toBeInTheDocument();
  });

  it("#576 a configured source shows its label, never its raw id", () => {
    setup();
    expect(screen.queryByText(/stateSource|nationalSource/)).toBeNull();
    expect(within(sourceList()).getByText("State system: pending")).toBeInTheDocument();
  });

  it("#576 a source the config does not list shows its id only as a last resort", () => {
    setup({
      ...ACK,
      parts: [{ ...ACK.parts[0], sourceIds: ["stateSource", "mysterySource"] }],
    } as SubmitQueryResponse);
    expect(within(sourceList()).getByText("State system: pending")).toBeInTheDocument();
    expect(
      within(sourceList()).getByText("Unlisted source mysterySource: pending"),
    ).toBeInTheDocument();
  });

  it("#576 ruling 12 the names carry the query type and the plate, never the command text", () => {
    setup(ACK, {
      queryType: "VEH",
      summary: "VEH.SECRETCMD",
      submitted: { queryType: "VEH", values: { plate: "ZZ-0001" }, sourceIds: [], mode: "normal" },
    });
    expect(screen.getByRole("group", { name: "Source status for Vehicle ZZ-0001" })).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: `Copy reference ${shortReference(ACK_CORRELATION_ID)} for Vehicle ZZ-0001`,
      }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /SECRETCMD/ })).toBeNull();
  });

  it("#576 ruling 12 a person's name stands for PER, last name first", () => {
    setup({ ...ACK, parts: [{ ...ACK.parts[0], queryType: "PER" }] } as SubmitQueryResponse, {
      queryType: "PER",
      summary: "PER.SECRETCMD",
      submitted: {
        queryType: "PER",
        values: { last: "TESTERSON", first: "AVERY", dob: "01-02-1990" },
        sourceIds: [],
        mode: "normal",
      },
    });
    expect(
      screen.getByRole("group", { name: "Source status for Person TESTERSON AVERY" }),
    ).toBeVisible();
    expect(screen.queryByRole("group", { name: /1990|SECRETCMD/ })).toBeNull();
  });

  it("#576 ruling 12 the short correlation ID names a request whose primary field is empty", () => {
    setup(ACK, { queryType: "VEH", summary: "VEH.SECRETCMD" });
    const short = shortReference(ACK_CORRELATION_ID);
    expect(screen.getByRole("group", { name: `Source status for Vehicle ${short}` })).toBeVisible();
    expect(
      screen.getByRole("button", { name: `Copy reference ${short} for Vehicle ${short}` }),
    ).toBeVisible();
  });

  it("#576 ruling 12 Retry is named by the type and the plate, not the command", () => {
    const services = testServices();
    services.authStore.getState().setSignedIn(TEST_USER);
    const id = services.requests.getState().begin({
      queryType: "VEH",
      summary: "VEH.SECRETCMD",
      submitted: { queryType: "VEH", values: { plate: "ZZ-0002" }, sourceIds: [], mode: "normal" },
    });
    act(() => {
      services.requests.getState().settle(id, { kind: "noResponse" });
    });
    renderRoutes([{ path: "/", element: <RequestsPane config={CLIENT_CONFIG} variant="list" /> }], {
      services,
    });
    expect(screen.getByRole("button", { name: "Retry Vehicle ZZ-0002" })).toBeVisible();
  });

  it("#576 the primary part is the one with no parent, wherever it sits in the list", () => {
    setup({
      ...ACK,
      parts: [
        {
          partId: 2,
          parentPartId: 5,
          origin: "alsoRun",
          queryType: "WNT",
          status: "dispatched",
          sourceIds: ["nationalSource"],
          droppedSourceIds: [],
          skipReasons: [],
        },
        { ...ACK.parts[0], partId: 5 },
      ],
    } as SubmitQueryResponse);
    expect(screen.getAllByText(/, also run from /)).toHaveLength(1);
    expect(screen.getByText("Wanted check, also run from Vehicle")).toBeInTheDocument();
  });

  it("#587 a dropped source with no configured label shows its id as a last resort", () => {
    setup({
      ...ACK,
      parts: [
        { ...ACK.parts[0], sourceIds: ["stateSource"], droppedSourceIds: ["unlabelledSource"] },
      ],
    } as SubmitQueryResponse);
    expect(
      within(sourceList()).getByText("Unlisted source unlabelledSource: not run (plate only)"),
    ).toBeInTheDocument();
  });

  it("sign-out empties the list", () => {
    const { services } = setup();
    act(() => services.reset.resetAll());
    expect(screen.queryByRole("group", { name: /Source status/ })).toBeNull();
  });
});
