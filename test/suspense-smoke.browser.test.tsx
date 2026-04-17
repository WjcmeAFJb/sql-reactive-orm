import React, { Suspense, use } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { resolved } from "../src/index.js";

afterEach(cleanup);

describe("react 19 use + Suspense smoke tests", () => {
  it("pre-stamped fulfilled promise renders synchronously", async () => {
    const p = resolved("hello");
    function C() {
      return <span data-testid="v">{use(p)}</span>;
    }
    const screen = await render(
      <Suspense fallback={<span>loading</span>}>
        <C />
      </Suspense>,
    );
    await expect.element(screen.getByTestId("v")).toHaveTextContent("hello");
  });

  it("pending promise resolves through Suspense", async () => {
    const p = new Promise<string>((r) => setTimeout(() => r("hi"), 20));
    function C() {
      return <span>{use(p)}</span>;
    }
    const screen = await render(
      <Suspense fallback={<span>loading</span>}>
        <C />
      </Suspense>,
    );
    await expect.element(screen.getByText("hi")).toBeInTheDocument();
  });
});
