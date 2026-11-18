import { expect, test } from "bun:test";

const { default: app } = (await import("./app")) as { default: { setup(builder: unknown): void } };

test("the columns page and its auto-open overlay register", () => {
  const calls: unknown[][] = [];
  const record = (kind: string) => (registration: { id: string; path?: string }) =>
    calls.push([kind, registration.id, registration.path]);
  app.setup({
    slots: { experimental_appOverlay: record("overlay"), navPanel: record("navPanel") },
  });
  expect(calls).toEqual([
    ["overlay", "subthread-columns", undefined],
    ["navPanel", "columns", "columns"],
  ]);
});
