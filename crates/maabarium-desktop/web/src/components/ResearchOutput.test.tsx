import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import ResearchOutput from "./ResearchOutput";

it("renders report structure and math without activating provider-supplied HTML or links", () => {
  const { container } = render(<ResearchOutput text={String.raw`## Example

- **Answer:** $A \to B$

$$
x + y
$$

![remote](https://example.invalid/track.png)

[link text](https://example.invalid/)

<iframe src="https://example.invalid/"></iframe>`} />);
  expect(screen.getByRole("heading", { name: "Example" })).toBeTruthy();
  expect(screen.getByRole("listitem")).toBeTruthy();
  expect(container.querySelector(".katex:not(.katex-display) math")).toBeTruthy();
  expect(container.querySelector(".katex-display math")).toBeTruthy();
  expect(container.querySelector("img, iframe, a")).toBeNull();
  expect(screen.getByText("link text")).toBeTruthy();
});
