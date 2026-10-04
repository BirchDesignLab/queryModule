import { createTranslator } from "@querymodule/client";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../app/i18n-context.js";
import { ServicesProvider } from "../app/services-context.js";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { testServices } from "../test/render-routes.js";
import { PublishDialogs } from "./PublishControls.js";
import type { PublishFlow } from "./PublishFlow.js";

// Task 33 part 2b (#507 items 5 and 6): what the publish dialogs do with the flow they are given,
// without the whole builder. UX-004.

const noop = () => {};
const FLOW: PublishFlow = {
  unsaved: false,
  changeCount: 1,
  version: 1,
  busy: false,
  conflict: false,
  notice: null,
  serverIssues: null,
  issueSeq: 0,
  reviewing: null,
  confirmingReload: false,
  rollingBack: null,
  historyStamp: 0,
  staleBase: false,
  save: noop,
  review: noop,
  publish: noop,
  cancelReview: noop,
  askReload: noop,
  cancelReload: noop,
  reload: noop,
  askRollback: noop,
  cancelRollback: noop,
  rollback: noop,
  retryLoad: noop,
};

const services = testServices();
const wrap = (ui: ReactNode) => (
  <ServicesProvider services={services}>
    <I18nProvider translator={createTranslator("en", EN_BUNDLE)}>{ui}</I18nProvider>
  </ServicesProvider>
);

describe("PublishDialogs", () => {
  it("5: a live check that finds no changes does not take Publish away while the dialog is open", () => {
    const doc = {};
    const open = { ...FLOW, reviewing: 2, changeCount: 1 };
    const view = render(wrap(<PublishDialogs flow={open} doc={doc} />));
    const dialog = screen.getByRole("dialog", { name: "Review and publish" });
    const publish = within(dialog).getByRole("button", { name: "Publish version 2" });
    publish.focus();
    // The live version moved to what the draft says while the dialog is open.
    view.rerender(wrap(<PublishDialogs flow={{ ...open, changeCount: 0 }} doc={doc} />));
    expect(within(dialog).getByRole("button", { name: "Publish version 2" })).toBe(publish);
    expect(publish).toHaveFocus();
    expect(dialog).not.toHaveTextContent("There is nothing to publish");
  });

  it("5: a review that opens with no changes still says so", () => {
    render(wrap(<PublishDialogs flow={{ ...FLOW, reviewing: 2, changeCount: 0 }} doc={{}} />));
    expect(screen.getByRole("dialog", { name: "Review and publish" })).toHaveTextContent(
      "There is nothing to publish",
    );
  });

  it("6: with its opener gone, the review dialog does not send focus to the History button", () => {
    const opener = document.createElement("button");
    const tab = document.createElement("button");
    const history = document.createElement("button");
    document.body.append(opener, tab, history);
    opener.focus();
    const props = {
      doc: {},
      fallback: () => tab,
      rollbackFallback: () => history,
    };
    const view = render(wrap(<PublishDialogs flow={FLOW} {...props} />));
    view.rerender(wrap(<PublishDialogs flow={{ ...FLOW, reviewing: 2 }} {...props} />));
    opener.remove();
    view.rerender(wrap(<PublishDialogs flow={FLOW} {...props} />));
    expect(tab).toHaveFocus();
    view.unmount();
    for (const el of [tab, history]) el.remove();
  });

  it("6: the roll back dialog, with its opener gone, goes to the History button", () => {
    const opener = document.createElement("button");
    const tab = document.createElement("button");
    const history = document.createElement("button");
    document.body.append(opener, tab, history);
    opener.focus();
    const props = {
      doc: {},
      fallback: () => tab,
      rollbackFallback: () => history,
    };
    const view = render(wrap(<PublishDialogs flow={FLOW} {...props} />));
    view.rerender(wrap(<PublishDialogs flow={{ ...FLOW, rollingBack: 3 }} {...props} />));
    opener.remove();
    view.rerender(wrap(<PublishDialogs flow={FLOW} {...props} />));
    expect(history).toHaveFocus();
    view.unmount();
    for (const el of [tab, history]) el.remove();
  });
});
