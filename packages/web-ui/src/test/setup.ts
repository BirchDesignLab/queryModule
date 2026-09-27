import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { installMatchMedia } from "./match-media.js";

installMatchMedia();
afterEach(() => {
  cleanup();
  installMatchMedia();
});
