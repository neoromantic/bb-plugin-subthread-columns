import { expect, test } from "bun:test";
import { UNREAD, rowAttention, withSeen, type Attention } from "./attention";
import { DEFAULT_LIMIT, NO_COLUMNS, columnLimit, descendants, eligibleIds, engage, isEligible, isRunning, isStolenFocus, needOf, nextColumns, routeChange, seenMark, settle, shouldAutoOpen, type ColumnThread } from "./columns";

const IDLE = { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 };

const thread = (id: string, parentThreadId: string | null, overrides: Partial<ColumnThread> = {}): ColumnThread => ({
  id,
  parentThreadId,
  displayTitle: id.toUpperCase(),
  status: "idle",
  runtimeStatus: "idle",
  queuedWork: "none",
  hasPendingInteraction: false,
  activity: IDLE,
  indicator: "none",
  isUnread: false,
  lastReadAt: 100,
  latestAttentionAt: 50,
  isHidden: false,
  isArchived: false,
  createdAt: 10,
  updatedAt: 100,
  ...overrides,
});
const record = (threadId: string, row: Partial<Attention> = {}): Attention => ({ threadId, resultAt: null, quietAttentionAt: null, seenAt: null, ...row });
const records = (...rows: Attention[]) => new Map(rows.map((row) => [row.threadId, row]));
const NONE = records();

/** Running in every sense BB reports. */
const WORKING: Partial<ColumnThread>[] = [
  ...(["starting", "active", "pending", "stopping"] as const).map((status) => ({ status })),
  ...(["provisioning", "waiting-for-host"] as const).map((runtimeStatus) => ({ runtimeStatus })),
  ...Object.keys(IDLE).map((key) => ({ activity: { ...IDLE, [key]: 1 } })),
  { queuedWork: "waiting" },
];

test("REPRO: a working descendant gets no column, in any sense BB reports running", () => {
  for (const working of WORKING) {
    expect(isRunning(thread("c", "a", working))).toBe(true);
    expect(isEligible(thread("c", "a", working), undefined)).toBe(false);
  }
  expect(isRunning(thread("c", "a"))).toBe(false);
  expect(isEligible(thread("c", "a"), undefined)).toBe(false);
});

test("an unknown status counts as idle", () => {
  const t = thread("c", "a", { status: "sleeping" as never, runtimeStatus: "warming" as never });
  expect(isRunning(t)).toBe(false);
  expect(isEligible(t, undefined)).toBe(false);
});

test("a descendant waiting for an answer or approval is eligible, even while busy", () => {
  expect(needOf(thread("c", "a", { hasPendingInteraction: true }), undefined)).toBe("waiting");
  expect(needOf(thread("c", "a", { indicator: "waiting-for-input" }), undefined)).toBe("waiting");
  for (const working of WORKING) expect(needOf(thread("c", "a", { ...working, hasPendingInteraction: true }), undefined)).toBe("waiting");
});

test("REPRO: a failure or an unread result does not count while the thread runs again", () => {
  const unread = record("c", { resultAt: 200 });
  expect(needOf(thread("c", "a"), unread)).toBe("unread");
  expect(needOf(thread("c", "a", { status: "error", updatedAt: 300 }), undefined)).toBe("failed");
  for (const working of WORKING) {
    expect(needOf(thread("c", "a", working), unread)).toBeNull();
    expect(needOf(thread("c", "a", { queuedWork: "failed", ...working, updatedAt: 300 }), undefined)).toBeNull();
  }
});

test("a failure is eligible until it is seen after its last update", () => {
  for (const failed of [{ status: "error" }, { queuedWork: "failed" }] as const) {
    const t = thread("c", "a", { ...failed, updatedAt: 300 });
    expect(isEligible(t, undefined)).toBe(true);
    expect(isEligible(t, record("c", { seenAt: 299 }))).toBe(true);
    expect(isEligible(t, record("c", { seenAt: 300 }))).toBe(false);
  }
});

test("an unread result is eligible by the same rule as the row's dot", () => {
  const t = thread("c", "a");
  const unread = records(record("c", { resultAt: 200 }));
  expect(isEligible(t, unread.get("c"))).toBe(true);
  expect(rowAttention(t, [t], unread)).toMatchObject({ status: UNREAD, unread: true });
  // Seen by the plugin or read in BB: no dot and no column.
  expect(isEligible(t, record("c", { resultAt: 200, seenAt: 200 }))).toBe(false);
  expect(isEligible(thread("c", "a", { lastReadAt: 250 }), unread.get("c"))).toBe(false);
});

// a ─┬─ b (old) ─── d
//    └─ c (new)
const tree = [
  thread("x", null),
  thread("c", "a", { createdAt: 30 }),
  thread("d", "b", { createdAt: 40 }),
  thread("a", null, { displayTitle: "Anchor" }),
  thread("b", "a", { createdAt: 20, displayTitle: "Parent" }),
  thread("h", "a", { isHidden: true, status: "active" }),
  thread("z", "a", { isArchived: true, status: "active" }),
];

test("descendants run depth first, oldest sibling first, without hidden or archived threads", () => {
  expect(descendants("a", tree).map(({ thread, depth, path }) => [thread.id, depth, path])).toEqual([
    ["b", 1, ["Anchor"]],
    ["d", 2, ["Anchor", "Parent"]],
    ["c", 1, ["Anchor"]],
  ]);
});

/** The tree with these threads waiting for his answer, and the rest as given. */
const asking = (ids: string[], threads: readonly ColumnThread[] = tree) => threads.map((t) => (ids.includes(t.id) ? { ...t, hasPendingInteraction: true } : t));
const ids = (layout: ReturnType<typeof nextColumns>) => layout.columns.map((c) => c.id);

test("an ineligible parent gets no column but stays in its child's path", () => {
  expect(nextColumns(NO_COLUMNS, "a", asking(["d"]), NONE)).toEqual({ columns: [{ id: "d", depth: 2, path: ["Anchor", "Parent"], title: "D", done: false }], more: [] });
});

test("a parent cycle cannot loop the tree", () => {
  const cycle = [thread("a", "b"), thread("b", "a", { status: "active" })];
  expect(descendants("a", cycle).map(({ thread }) => thread.id)).toEqual(["b"]);
});

test("shown columns stay as done; new ones join at their tree position", () => {
  const first = nextColumns(NO_COLUMNS, "a", asking(["c"]), NONE);
  expect(ids(first)).toEqual(["c"]);
  const second = nextColumns(first, "a", asking(["d"]), NONE);
  expect(second.columns.map((c) => [c.id, c.done])).toEqual([
    ["d", false],
    ["c", true],
  ]);
  // Done columns come back to life when they need him again.
  expect(nextColumns(second, "a", asking(["c", "d"]), NONE).columns.map((c) => c.done)).toEqual([false, false]);
});

test("REPRO: a shown column whose thread starts working again is not done", () => {
  const shown = nextColumns(NO_COLUMNS, "a", asking(["c"]), NONE);
  for (const working of WORKING) {
    const threads = tree.map((t) => (t.id === "c" ? { ...t, ...working } : t));
    expect(nextColumns(shown, "a", threads, NONE).columns).toEqual([{ ...shown.columns[0]!, done: false }]);
  }
});

test("archived, deleted and moved threads lose their column, except the one he is in", () => {
  const shown = nextColumns(NO_COLUMNS, "a", asking(["b", "c"]), NONE);
  const gone = tree.filter((t) => t.id !== "b").map((t) => (t.id === "c" ? { ...t, isArchived: true } : t));
  expect(nextColumns(shown, "a", gone, NONE).columns).toEqual([]);
  expect(nextColumns(shown, "a", gone, NONE, { held: ["c"] }).columns).toEqual([{ ...shown.columns[1]!, done: true }]);
  const moved = asking(["c"]).map((t) => (t.id === "b" ? { ...t, parentThreadId: "x" } : t));
  expect(nextColumns(shown, "a", moved, NONE, { held: ["b"] }).columns.map((c) => [c.id, c.done])).toEqual([
    ["b", true],
    ["c", false],
  ]);
});

test("eligible ids are every descendant that needs him, whatever the limit", () => {
  const threads = asking(["c"]);
  expect(eligibleIds("a", threads, records(record("d", { resultAt: 200 })))).toEqual(["d", "c"]);
  expect(nextColumns(NO_COLUMNS, "a", threads, records(record("d", { resultAt: 200 })), { limit: 1 }).more).toEqual([{ id: "d", title: "D" }]);
  expect(eligibleIds("missing", threads, NONE)).toEqual([]);
});

// a ─┬─ p1 ── q1
//    ├─ p2 ── q2
//    ├─ p3
//    └─ p4
const wide = [
  thread("a", null, { displayTitle: "Anchor" }),
  ...[1, 2, 3, 4].map((n) => thread(`p${n}`, "a", { createdAt: n })),
  thread("q1", "p1", { createdAt: 5 }),
  thread("q2", "p2", { createdAt: 6 }),
];
const set = (threads: readonly ColumnThread[], changes: Record<string, Partial<ColumnThread>>) => threads.map((t) => ({ ...t, ...changes[t.id] }));

test("REPRO: over the limit, waiting comes first, then failed, then unread, newest first; shown in tree order", () => {
  const threads = set(wide, {
    p1: { updatedAt: 500 }, // unread, result at 450
    q1: { status: "error", updatedAt: 400 },
    p2: { hasPendingInteraction: true, updatedAt: 200 },
    q2: { status: "error", updatedAt: 300 },
    p3: { indicator: "waiting-for-input", status: "active", updatedAt: 100 },
    p4: {}, // unread, result at 460
  });
  const attention = records(record("p1", { resultAt: 450 }), record("p4", { resultAt: 460 }));
  const pick = (limit: number) => nextColumns(NO_COLUMNS, "a", threads, attention, { limit });
  expect(ids(pick(2))).toEqual(["p2", "p3"]);
  expect(ids(pick(3))).toEqual(["q1", "p2", "p3"]);
  expect(ids(pick(5))).toEqual(["q1", "p2", "q2", "p3", "p4"]);
  expect(pick(5).more).toEqual([{ id: "p1", title: "P1" }]);
  expect(ids(pick(6))).toEqual(["p1", "q1", "p2", "q2", "p3", "p4"]);
  expect(pick(6).more).toEqual([]);
});

test("REPRO: +N more lists the eligible descendants left without a column, most urgent first", () => {
  const threads = set(wide, { p1: { hasPendingInteraction: true }, p2: { status: "error", updatedAt: 300 }, p3: { status: "error", updatedAt: 310 }, p4: {} });
  const layout = nextColumns(NO_COLUMNS, "a", threads, records(record("p4", { resultAt: 200 })), { limit: 1 });
  expect(ids(layout)).toEqual(["p1"]);
  expect(layout.more.map((entry) => entry.id)).toEqual(["p3", "p2", "p4"]);
  // Working descendants are not counted.
  expect(nextColumns(NO_COLUMNS, "a", set(wide, { p1: { hasPendingInteraction: true }, p2: { status: "active" } }), NONE, { limit: 1 }).more).toEqual([]);
});

test("REPRO: when full, a newly eligible descendant replaces the oldest done column, at its own tree position", () => {
  const first = nextColumns(NO_COLUMNS, "a", set(wide, { p1: { hasPendingInteraction: true }, p3: { hasPendingInteraction: true } }), NONE, { limit: 2 });
  expect(ids(first)).toEqual(["p1", "p3"]);
  // p1 and p3 are answered; p3 went idle first. Then q2 asks.
  const answered = set(wide, { p1: { updatedAt: 300 }, p3: { updatedAt: 200 }, q2: { hasPendingInteraction: true } });
  const next = nextColumns(first, "a", answered, NONE, { limit: 2 });
  expect(next.columns.map((c) => [c.id, c.done])).toEqual([
    ["p1", true],
    ["q2", false],
  ]);
  expect(next.more).toEqual([]);
});

test("REPRO: a running sticky column counts toward the limit and is never replaced", () => {
  const first = nextColumns(NO_COLUMNS, "a", set(wide, { p1: { hasPendingInteraction: true }, p3: { hasPendingInteraction: true } }), NONE, { limit: 2 });
  // He answered both; both work again, and q2 asks.
  const working = set(wide, { p1: { status: "active", updatedAt: 300 }, p3: { activity: { ...IDLE, workflows: 1 }, updatedAt: 200 }, q2: { hasPendingInteraction: true } });
  const next = nextColumns(first, "a", working, NONE, { limit: 2 });
  expect(next.columns.map((c) => [c.id, c.done])).toEqual([
    ["p1", false],
    ["p3", false],
  ]);
  expect(next.more).toEqual([{ id: "q2", title: "Q2" }]);
});

test("REPRO: a descendant already counted in +N more never replaces a done column; only a newcomer does", () => {
  const first = nextColumns(NO_COLUMNS, "a", set(wide, { p1: { hasPendingInteraction: true }, p3: { hasPendingInteraction: true }, p4: { status: "error", updatedAt: 300 } }), NONE, { limit: 2 });
  expect(ids(first)).toEqual(["p1", "p3"]);
  expect(first.more).toEqual([{ id: "p4", title: "P4" }]);
  // He answers p1 elsewhere: p1 is done and stays, dimmed; p4 keeps waiting.
  const answered = set(wide, { p1: { updatedAt: 310 }, p3: { hasPendingInteraction: true }, p4: { status: "error", updatedAt: 300 } });
  const second = nextColumns(first, "a", answered, NONE, { limit: 2 });
  expect(second.columns.map((c) => [c.id, c.done])).toEqual([
    ["p1", true],
    ["p3", false],
  ]);
  expect(second.more).toEqual([{ id: "p4", title: "P4" }]);
  // Then q1 starts waiting: it is new, so it takes p1's place; p4 still waits.
  const third = nextColumns(second, "a", set(answered, { q1: { hasPendingInteraction: true } }), NONE, { limit: 2 });
  expect(ids(third)).toEqual(["q1", "p3"]);
  expect(third.more).toEqual([{ id: "p4", title: "P4" }]);
  // A free place goes to the one waiting.
  expect(ids(nextColumns(third, "a", set(answered, { q1: { hasPendingInteraction: true } }), NONE, { limit: 3 }))).toEqual(["q1", "p3", "p4"]);
});

test("a done column he is in, clicked or by focus, is never replaced; without a done one left, the newcomer waits", () => {
  const first = nextColumns(NO_COLUMNS, "a", set(wide, { p1: { hasPendingInteraction: true }, p3: { hasPendingInteraction: true } }), NONE, { limit: 2 });
  const answered = set(wide, { p1: { updatedAt: 300 }, p3: { updatedAt: 200 }, q2: { hasPendingInteraction: true } });
  expect(ids(nextColumns(first, "a", answered, NONE, { limit: 2, held: ["p3", null] }))).toEqual(["q2", "p3"]);
  const both = nextColumns(first, "a", answered, NONE, { limit: 2, held: ["p1", "p3"] });
  expect(ids(both)).toEqual(["p1", "p3"]);
  expect(both.more).toEqual([{ id: "q2", title: "Q2" }]);
});

test("a gone column he is in still counts toward the limit", () => {
  const first = nextColumns(NO_COLUMNS, "a", set(wide, { p3: { hasPendingInteraction: true } }), NONE, { limit: 1 });
  const archived = set(wide, { p3: { isArchived: true }, p4: { hasPendingInteraction: true } });
  const next = nextColumns(first, "a", archived, NONE, { limit: 1, held: ["p3"] });
  expect(next.columns.map((c) => [c.id, c.done])).toEqual([["p3", true]]);
  expect(next.more).toEqual([{ id: "p4", title: "P4" }]);
});

test("a lower limit keeps the columns already shown; a higher one lets the rest in", () => {
  const all = set(wide, { p1: { hasPendingInteraction: true }, p2: { hasPendingInteraction: true }, p3: { hasPendingInteraction: true } });
  const shown = nextColumns(NO_COLUMNS, "a", all, NONE, { limit: 3 });
  expect(nextColumns(shown, "a", all, NONE, { limit: 1 })).toEqual(shown);
  const one = nextColumns(NO_COLUMNS, "a", all, NONE, { limit: 1 });
  expect(one.more).toHaveLength(2);
  expect(ids(nextColumns(one, "a", all, NONE, { limit: 3 }))).toEqual(["p1", "p2", "p3"]);
});

test("the limit reads 8 unless the setting is a positive whole number", () => {
  expect(DEFAULT_LIMIT).toBe(8);
  for (const value of [undefined, null, "12", 0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(columnLimit(value)).toBe(8);
  expect(columnLimit(1)).toBe(1);
  expect(columnLimit(12)).toBe(12);
});

test("settle keeps unchanged columns as the same objects, and the whole layout when nothing changed", () => {
  const before = nextColumns(NO_COLUMNS, "a", asking(["c", "d"]), NONE);
  expect(settle(before, nextColumns(before, "a", asking(["c", "d"]), NONE))).toBe(before);
  const after = settle(before, nextColumns(before, "a", asking(["c"]), NONE));
  expect(after).not.toBe(before);
  expect(after.columns[0]).toEqual({ ...before.columns[0]!, done: true });
  expect(after.columns[1]).toBe(before.columns[1]!);
  expect(after.more).toBe(before.more);
});

const open = (overrides: Partial<Parameters<typeof shouldAutoOpen>[0]> = {}) =>
  shouldAutoOpen({ setting: "auto", compact: false, inPane: false, eligible: ["c"], suppressed: null, ...overrides });

test("REPRO: a thread whose subthreads only work opens plainly", () => {
  const working = set(wide, { p1: { status: "active" }, q2: { activity: { ...IDLE, backgroundAgents: 1 } }, p4: { queuedWork: "waiting" } });
  expect(open({ eligible: eligibleIds("a", working, NONE) })).toBe(false);
  // One passive descendant among them is enough.
  expect(open({ eligible: eligibleIds("a", set(working, { p3: { status: "error", updatedAt: 300 } }), NONE) })).toBe(true);
});

test("auto-open needs the setting, a wide window, a new pane and an eligible descendant", () => {
  expect(open()).toBe(true);
  expect(open({ setting: undefined })).toBe(true);
  expect(open({ setting: "off" })).toBe(false);
  expect(open({ compact: true })).toBe(false);
  expect(open({ inPane: true })).toBe(false);
  expect(open({ eligible: [] })).toBe(false);
});

test("after Only this thread, only a descendant it did not see brings the columns back", () => {
  expect(open({ suppressed: ["c"] })).toBe(false);
  expect(open({ eligible: [], suppressed: [] })).toBe(false);
  expect(open({ eligible: ["c", "d"], suppressed: ["c"] })).toBe(true);
});

test("the seen mark covers the result and, for a failure, its last update", () => {
  expect(seenMark(thread("c", "a"), record("c", { resultAt: 200 }))).toBe(200);
  expect(seenMark(thread("c", "a", { status: "error", updatedAt: 300 }), undefined)).toBe(300);
  expect(seenMark(thread("c", "a", { queuedWork: "failed", updatedAt: 150 }), record("c", { resultAt: 200 }))).toBe(200);
  expect(seenMark(thread("c", "a"), undefined)).toBe(0);
});

test("a descendant is seen once he clicks into its column and then clicks anywhere else", () => {
  // Click into c, then the anchor, another column, or outside all of them.
  expect(engage(null, "c", "a", "pointer")).toEqual({ engaged: "c", leave: null });
  expect(engage("c", "c", "a", "pointer")).toEqual({ engaged: "c", leave: null });
  expect(engage("c", "a", "a", "pointer")).toEqual({ engaged: null, leave: "c" });
  expect(engage("c", "d", "a", "pointer")).toEqual({ engaged: "d", leave: "c" });
  expect(engage("c", null, "a", "pointer")).toEqual({ engaged: null, leave: "c" });
  expect(engage(null, "a", "a", "pointer")).toEqual({ engaged: null, leave: null });
});

test("REPRO: Tab or programmatic focus into a column does not engage it", () => {
  expect(engage(null, "c", "a", "focus")).toEqual({ engaged: null, leave: null });
  expect(engage(null, "a", "a", "focus")).toEqual({ engaged: null, leave: null });
  expect(engage(null, null, "a", "focus")).toEqual({ engaged: null, leave: null });
});

test("focus leaving the clicked column marks it seen; focus inside it keeps it", () => {
  expect(engage("c", "c", "a", "focus")).toEqual({ engaged: "c", leave: null });
  expect(engage("c", "a", "a", "focus")).toEqual({ engaged: null, leave: "c" });
  expect(engage("c", null, "a", "focus")).toEqual({ engaged: null, leave: "c" });
  // Focus moving into another column leaves c without engaging d.
  expect(engage("c", "d", "a", "focus")).toEqual({ engaged: null, leave: "c" });
});

test("a menu or picker opened from the column keeps the engagement", () => {
  for (const kind of ["pointer", "focus"] as const) expect(engage("c", undefined, "a", kind)).toEqual({ engaged: "c", leave: null });
});

const focus = (overrides: Partial<Parameters<typeof isStolenFocus>[0]> = {}) =>
  isStolenFocus({ engaged: null, target: "d", anchorId: "a", editable: true, afterTab: false, keyColumn: null, ...overrides });

test("REPRO: a mounting column's composer cannot take focus from the anchor or the clicked column", () => {
  // BB's composer focuses itself on mount: in d, while focus is in the anchor or in clicked c.
  expect(focus()).toBe(true);
  expect(focus({ engaged: "c" })).toBe(true);
  // Tab, the clicked column itself, the anchor and the outside are his.
  expect(focus({ afterTab: true })).toBe(false);
  expect(focus({ engaged: "c", target: "c" })).toBe(false);
  expect(focus({ engaged: "c", target: "a" })).toBe(false);
  expect(focus({ engaged: "c", target: null })).toBe(false);
  expect(focus({ engaged: "c", target: undefined })).toBe(false);
});

test("REPRO: focus that a picker or toggle returns to its button is not stolen", () => {
  // Escape closes the model picker; about 390ms later focus goes back to its trigger.
  expect(focus({ editable: false })).toBe(false);
  expect(focus({ editable: false, keyColumn: "c" })).toBe(false);
});

test("REPRO: typing in one column never lets another column's composer take focus", () => {
  expect(focus({ engaged: "c", keyColumn: "c" })).toBe(true);
  expect(focus({ keyColumn: "a" })).toBe(true);
});

test("a key pressed in the same column, then focus to its editor, is his", () => {
  // Enter on a button in d that opens an editor there.
  expect(focus({ keyColumn: "d" })).toBe(false);
});

test("REPRO: a thread opened into a new split pane counts as opened, though BB adds the pane first", () => {
  // Only pane A was open; Cmd-click put T into a new pane before the route moved to T.
  const change = routeChange(new Set(["A"]), "T", ["A", "T"]);
  expect(change.inPane).toBe(false);
  expect([...change.panes]).toEqual(["A", "T"]);
});

test("focusing a pane that was already open is not opening", () => {
  const opened = routeChange(new Set(["A"]), "T", ["A", "T"]);
  expect(routeChange(opened.panes, "A", ["A", "T"]).inPane).toBe(true);
  expect(routeChange(routeChange(opened.panes, "A", ["A", "T"]).panes, "T", ["A", "T"]).inPane).toBe(true);
  // A plugin page in a pane has no thread; a plain click replaces the focused pane's thread.
  expect(routeChange(new Set(["A", "B"]), null, [null, "B"])).toEqual({ inPane: false, panes: new Set(["B"]) });
  expect(routeChange(new Set(["A", "B"]), "C", ["C", "B"]).inPane).toBe(false);
  // Without a split there are no panes to focus.
  expect(routeChange(new Set(), "T", []).inPane).toBe(false);
});

test("REPRO: a seen failure stays seen in the row and leaves no column", () => {
  const failed = thread("c", "a", { status: "error", updatedAt: 300 });
  const seen = records(record("c", { resultAt: 200, seenAt: seenMark(failed, record("c", { resultAt: 200 })) }));
  expect(isEligible(failed, seen.get("c"))).toBe(false);
  // The row keeps BB's failure cross; only the dot clears.
  expect(rowAttention(failed, [failed], seen)).toMatchObject({ failed: true, unread: false });
});

test("REPRO: without Responsibilities a failed child keeps its column through BB's mount read, until he clicks in and leaves", () => {
  // BB's chat marks a failed child read as soon as its column mounts.
  const failed = thread("c", "a", { status: "error", updatedAt: 300, lastReadAt: 300 });
  const none = withSeen(undefined, {});
  expect(needOf(failed, none.get("c"))).toBe("failed");
  // The mounting composer's focus engages nothing and leaves nothing.
  expect(isStolenFocus({ engaged: null, target: "c", anchorId: "a", editable: true, afterTab: false, keyColumn: null })).toBe(true);
  expect(engage(null, "c", "a", "focus")).toEqual({ engaged: null, leave: null });
  // A click in, then a click elsewhere: seen in this browser.
  const into = engage(null, "c", "a", "pointer");
  expect(engage(into.engaged, null, "a", "pointer").leave).toBe("c");
  const seen = withSeen(undefined, { c: seenMark(failed, none.get("c")) });
  expect(isEligible(failed, seen.get("c"))).toBe(false);
  // The next opening starts over and still leaves it out; a new failure brings it back.
  expect(nextColumns(NO_COLUMNS, "a", [thread("a", null), failed], seen).columns).toEqual([]);
  expect(isEligible({ ...failed, updatedAt: 400 }, seen.get("c"))).toBe(true);
});

test("REPRO: without Responsibilities only waiting and failed descendants need him; its records later add unread ones as new columns", () => {
  const threads = [thread("a", null), thread("f", "a", { status: "error", updatedAt: 300 }), thread("r", "a"), thread("w", "a", { hasPendingInteraction: true })];
  const none = withSeen(undefined, {});
  expect(eligibleIds("a", threads, none)).toEqual(["f", "w"]);
  const page = nextColumns(NO_COLUMNS, "a", threads, none);
  const late = withSeen([record("r", { resultAt: 200 })], {});
  expect(nextColumns(page, "a", threads, late).columns.map((column) => column.id)).toEqual(["f", "r", "w"]);
});

test("a seen mark of this browser counts over Responsibilities' record, and a newer one of theirs over it", () => {
  const rows = [record("c", { resultAt: 200, seenAt: 150 })];
  expect(withSeen(rows, { c: 200 }).get("c")).toEqual(record("c", { resultAt: 200, seenAt: 200 }));
  expect(withSeen(rows, { c: 100 }).get("c")).toEqual(record("c", { resultAt: 200, seenAt: 150 }));
  expect(withSeen(undefined, { c: 100 }).get("c")).toEqual(record("c", { seenAt: 100 }));
});
