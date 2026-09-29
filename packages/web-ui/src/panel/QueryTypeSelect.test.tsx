import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryTypeSelect } from "./QueryTypeSelect.js";

const t = (key: string) => (key === "form.queryType" ? "Query type" : key);
const OPTIONS = [
  { code: "VEH", label: "Vehicle" },
  { code: "PER", label: "Person" },
];

describe("query type select (spec 6.2)", () => {
  it("is a labelled select of the given options showing the current type", () => {
    render(
      <QueryTypeSelect id="qt" value="PER" options={OPTIONS} onChange={() => undefined} t={t} />,
    );
    const select = screen.getByLabelText("Query type");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveValue("PER");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Vehicle", "Person"]);
  });
  it("reports the chosen code", async () => {
    const onChange = vi.fn();
    render(<QueryTypeSelect id="qt" value="VEH" options={OPTIONS} onChange={onChange} t={t} />);
    await userEvent.selectOptions(screen.getByLabelText("Query type"), "PER");
    expect(onChange).toHaveBeenCalledWith("PER");
  });
});
