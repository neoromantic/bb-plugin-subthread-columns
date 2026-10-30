import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isUnread, type Attention, type AttentionThread } from "./attention";

export type ColumnThread = AttentionThread &
  Pick<PluginSidebarThread, "displayTitle" | "runtimeStatus" | "queuedWork" | "hasPendingInteraction" | "activity" | "isHidden" | "isArchived" | "createdAt" | "updatedAt">;

/**
 * A descendant's column: its depth under the anchor (1..n) and the titles from
 * the anchor down to its parent. `done`: idle and no longer needing him.
 */
export type Column = { id: string; depth: number; path: readonly string[]; title: string; done: boolean };

/** The page's columns, and the eligible descendants the limit left without one, most urgent first. */
export type Layout = { columns: readonly Column[]; more: readonly { id: string; title: string }[] };

export const NO_COLUMNS: Layout = { columns: [], more: [] };

/** Descendant columns a page shows at most; the anchor's column is extra. */
export const DEFAULT_LIMIT = 8;
export const columnLimit = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : DEFAULT_LIMIT);

// Unknown statuses count as idle, as the SDK asks.
const BUSY = new Set<string>(["starting", "active", "pending", "stopping"]);
const NOT_READY = new Set<string>(["provisioning", "waiting-for-host"]);

export const isFailed = (thread: ColumnThread) => thread.status === "error" || thread.queuedWork === "failed";

/** Busy, machine not ready, a workflow, background agent or command, plan mode or goal, or a queued message. */
export const isRunning = (thread: ColumnThread) =>
  BUSY.has(thread.status) || NOT_READY.has(thread.runtimeStatus) || Object.values(thread.activity).some((count) => count > 0) || thread.queuedWork === "waiting";

/** What a descendant needs from him, most urgent first. */
export type Need = "waiting" | "failed" | "unread";
const URGENCY: Record<Need, number> = { waiting: 0, failed: 1, unread: 2 };

/**
 * Waiting for his answer or approval, even while busy: the agent is blocked on
 * him. Otherwise only an idle thread needs him: failed and not seen since its
 * last update, or holding an unread result. Null: it needs nothing now.
 */
export function needOf(thread: ColumnThread, attention: Attention | undefined): Need | null {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "waiting";
  if (isRunning(thread)) return null;
  if (isFailed(thread) && (attention?.seenAt ?? 0) < thread.updatedAt) return "failed";
  return isUnread(thread, attention) ? "unread" : null;
}

export const isEligible = (thread: ColumnThread, attention: Attention | undefined) => needOf(thread, attention) !== null;

/** The anchor's visible descendants, depth first, siblings oldest first: the client's thread array is not in sidebar order. */
export function descendants<T extends ColumnThread>(anchorId: string, threads: readonly T[]) {
  const visible = threads.filter((thread) => !thread.isHidden && !thread.isArchived);
  const children = Map.groupBy(visible, (thread) => thread.parentThreadId);
  for (const list of children.values()) list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const out: { thread: T; depth: number; path: string[] }[] = [];
  const visited = new Set([anchorId]);
  const walk = (id: string, depth: number, path: string[]) => {
    for (const child of children.get(id) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      out.push({ thread: child, depth, path });
      walk(child.id, depth + 1, [...path, child.displayTitle]);
    }
  };
  const anchor = visible.find((thread) => thread.id === anchorId);
  if (anchor) walk(anchorId, 1, [anchor.displayTitle]);
  return out;
}

/**
 * The page's columns after a change, in tree order. A column shown so far
 * stays while its thread is a visible descendant; once it is idle and needs
 * nothing it is done. An eligible descendant without a column gets one while
 * fewer than `limit` show, most urgent first, then newest. On a full page, one
 * that became eligible since `prev` takes the place of the oldest done column
 * he is not in; the rest wait in `more`. `held`: the columns he is in, clicked
 * or holding focus. They are never replaced, and stay, done, when their thread
 * is gone, after the column they followed.
 */
export function nextColumns(
  prev: Layout,
  anchorId: string,
  threads: readonly ColumnThread[],
  attention: ReadonlyMap<string, Attention>,
  { limit = DEFAULT_LIMIT, held = [] }: { limit?: number; held?: readonly (string | null)[] } = {},
): Layout {
  const tree = descendants(anchorId, threads).map((entry) => ({ ...entry, need: needOf(entry.thread, attention.get(entry.thread.id)) }));
  const done = (entry: (typeof tree)[number]) => !entry.need && !isRunning(entry.thread);
  const shown = new Set(prev.columns.map((column) => column.id));
  const waited = new Set(prev.more.map((entry) => entry.id));
  const show = new Set(tree.flatMap(({ thread }) => (shown.has(thread.id) ? [thread.id] : [])));
  const gone = prev.columns.filter((column) => held.includes(column.id) && !show.has(column.id));
  const replaceable = tree.filter((entry) => show.has(entry.thread.id) && done(entry) && !held.includes(entry.thread.id)).sort((a, b) => a.thread.updatedAt - b.thread.updatedAt);
  const at = ({ thread, need }: (typeof tree)[number]) => (need === "unread" ? (attention.get(thread.id)?.resultAt ?? thread.updatedAt) : thread.updatedAt);
  const candidates = tree
    .filter((entry): entry is typeof entry & { need: Need } => entry.need !== null && !shown.has(entry.thread.id))
    .sort((a, b) => URGENCY[a.need] - URGENCY[b.need] || at(b) - at(a));
  const more: { id: string; title: string }[] = [];
  for (const { thread } of candidates) {
    if (show.size + gone.length < limit) show.add(thread.id);
    else {
      // Only a newcomer takes a done column's place; one already waiting keeps waiting.
      const oldest = waited.has(thread.id) ? undefined : replaceable.shift();
      if (oldest) {
        show.delete(oldest.thread.id);
        show.add(thread.id);
      } else more.push({ id: thread.id, title: thread.displayTitle });
    }
  }
  const columns: Column[] = tree.flatMap((entry) =>
    show.has(entry.thread.id) ? [{ id: entry.thread.id, depth: entry.depth, path: entry.path, title: entry.thread.displayTitle, done: done(entry) }] : [],
  );
  prev.columns.forEach((column, index) => {
    if (!gone.includes(column)) return;
    const before = prev.columns.slice(0, index).findLast((earlier) => columns.some((next) => next.id === earlier.id));
    columns.splice(before ? columns.findIndex((next) => next.id === before.id) + 1 : 0, 0, { ...column, done: true });
  });
  return { columns, more };
}

const sameColumn = (a: Column, b: Column) =>
  a.id === b.id && a.depth === b.depth && a.title === b.title && a.done === b.done && a.path.length === b.path.length && a.path.every((title, i) => title === b.path[i]);

/** `next`, keeping each unchanged column of `prev` as the same object, or `prev` itself when nothing changed. */
export function settle(prev: Layout, next: Layout): Layout {
  const old = new Map(prev.columns.map((column) => [column.id, column]));
  const columns = next.columns.map((column) => {
    const before = old.get(column.id);
    return before && sameColumn(before, column) ? before : column;
  });
  const sameMore = next.more.length === prev.more.length && next.more.every((entry, i) => entry.id === prev.more[i]?.id && entry.title === prev.more[i]?.title);
  if (sameMore && columns.length === prev.columns.length && columns.every((column, i) => column === prev.columns[i])) return prev;
  return { columns, more: sameMore ? prev.more : next.more };
}

/** The descendants that need him now, whether or not the limit leaves them a column. */
export const eligibleIds = (anchorId: string, threads: readonly ColumnThread[], attention: ReadonlyMap<string, Attention>) =>
  descendants(anchorId, threads).flatMap(({ thread }) => (isEligible(thread, attention.get(thread.id)) ? [thread.id] : []));

/**
 * Whether opening a thread shows its columns instead. `inPane`: it was already
 * shown in a split pane, so this only focuses it. `suppressed`: the eligible
 * descendants "Only this thread" saw; only a new one brings the columns back.
 */
export function shouldAutoOpen(args: {
  setting: unknown;
  compact: boolean;
  inPane: boolean;
  eligible: readonly string[];
  suppressed: readonly string[] | null;
}): boolean {
  const { setting, compact, inPane, eligible, suppressed } = args;
  if (setting === "off" || compact || inPane || eligible.length === 0) return false;
  return suppressed === null || eligible.some((id) => !suppressed.includes(id));
}

/**
 * A change of the route's thread. `before`: the threads in split panes when the
 * route thread last changed; BB writes a new split pane before it navigates,
 * so the current layout would already hold the thread. Focusing a pane that
 * was open then is not opening. Returns the snapshot for the next change.
 */
export function routeChange(before: ReadonlySet<string>, threadId: string | null, paneThreads: readonly (string | null)[]) {
  return { inPane: threadId !== null && before.has(threadId), panes: new Set(paneThreads.filter((id): id is string => id !== null)) };
}

/** The seen mark for a column he engaged and left: its result, and for a failure its last update. */
export const seenMark = (thread: ColumnThread, attention: Attention | undefined) =>
  Math.max(attention?.resultAt ?? 0, isFailed(thread) ? thread.updatedAt : 0);

/**
 * Where a pointer or focus event leaves engagement. `target` is the column it
 * hit, null outside every column, undefined in a layer that belongs to none (a
 * menu or dialog). Only a click engages a descendant; focus elsewhere, by Tab
 * or by a script, only leaves one. The anchor is never engaged. `leave` is
 * the descendant just left, which now counts as seen.
 */
export function engage(
  engaged: string | null,
  target: string | null | undefined,
  anchorId: string,
  kind: "pointer" | "focus",
): { engaged: string | null; leave: string | null } {
  if (target === undefined || target === engaged) return { engaged, leave: null };
  const next = kind === "pointer" && target !== anchorId ? target : null;
  return next === engaged ? { engaged, leave: null } : { engaged: next, leave: engaged };
}

/**
 * Focus that lands in a descendant's editor on its own: BB's composer focuses
 * itself when it mounts, so every new or lazily mounted column would take it.
 * His own ways in stay: a click (which engages the column first), Tab, a key
 * pressed in that same column (`keyColumn`, the last keydown's column within
 * about 1s), and focus coming back to a button such as a picker's trigger.
 */
export function isStolenFocus(focus: {
  engaged: string | null;
  target: string | null | undefined;
  anchorId: string;
  editable: boolean;
  afterTab: boolean;
  keyColumn: string | null | undefined;
}): boolean {
  const { engaged, target, anchorId, editable, afterTab, keyColumn } = focus;
  return typeof target === "string" && target !== anchorId && target !== engaged && editable && !afterTab && keyColumn !== target;
}
