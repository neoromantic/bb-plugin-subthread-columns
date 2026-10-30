import { expect, mock, test } from "bun:test";

// The host supplies React; registration itself renders nothing.
mock.module("react", () => ({ memo: (component: unknown) => component, useCallback() {}, useEffect() {}, useLayoutEffect() {}, useMemo() {}, useRef() {}, useState() {}, useSyncExternalStore() {} }));
mock.module("react/jsx-runtime", () => ({ jsx() {}, jsxs() {}, Fragment: "Fragment" }));
const { default: app } = (await import("./app")) as { default: { setup(builder: unknown): void } };

test("the columns page and its auto-open overlay register", () => {
  const calls: unknown[][] = [];
  const record = (kind: string) => (registration: { id: string; path?: string }) => calls.push([kind, registration.id, registration.path]);
  app.setup({
    slots: { experimental_appOverlay: record("overlay"), navPanel: record("navPanel") },
  });
  expect(calls).toEqual([
    ["overlay", "subthread-columns", undefined],
    ["navPanel", "columns", "columns"],
  ]);
});
