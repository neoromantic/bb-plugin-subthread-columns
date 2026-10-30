import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ThreadChat,
  ThreadTitle,
  experimental_Icon as Icon,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useSettings,
  useSidebarSplitLayout,
  type PluginComposerThreadRowStatus,
  type PluginNavPanelProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { rowAttention, type Attention } from "./attention";
import { NO_COLUMNS, columnLimit, eligibleIds, engage, isStolenFocus, nextColumns, routeChange, seenMark, settle, shouldAutoOpen, type Column, type Layout } from "./columns";
import { useAttention, useMarkSeen, useSeenWhileShown } from "./use-attention";

export const COLUMNS_PATH = "columns";
/** BB's own compact breakpoint (`useIsCompactViewport`). */
const COMPACT = "(max-width: 767px)";
const SUPPRESS = "subthread-columns/only-this-thread:";
const ROW = "[data-sidebar-rename-row]";
/** Layers a column opens outside itself: its menus, pickers and dialogs. */
const FLOATING = '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"]';

export const COLUMNS_CSS = `
[data-mea-columns] { position: relative; flex: 1; min-height: 0; display: flex; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; }
[data-mea-columns-hint] { margin: auto; font-size: var(--text-sm); color: var(--muted-foreground); }
[data-mea-column] { --stripe: var(--border); flex: none; width: 440px; max-width: 100%; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); transition: opacity .2s; }
[data-mea-column][data-anchor] { width: 560px; }
[data-mea-column][data-hue="1"] { --stripe: var(--chart-1, oklch(.65 .15 255)); }
[data-mea-column][data-hue="2"] { --stripe: var(--chart-2, oklch(.68 .14 165)); }
[data-mea-column][data-hue="3"] { --stripe: var(--chart-3, oklch(.72 .15 75)); }
[data-mea-column][data-hue="4"] { --stripe: var(--chart-4, oklch(.64 .17 325)); }
[data-mea-column][data-hue="5"] { --stripe: var(--chart-5, oklch(.68 .12 210)); }
[data-mea-column][data-hue="6"] { --stripe: var(--chart-6, oklch(.64 .16 25)); }
[data-mea-column][data-done]:not([data-engaged]) { opacity: .55; }
[data-mea-column][data-fresh] > header { animation: mea-column-in 2s ease-out; }
@keyframes mea-column-in { from { background: color-mix(in oklab, var(--stripe) 30%, transparent); } }
[data-mea-column] > header { flex: none; display: flex; flex-direction: column; justify-content: flex-end; gap: 1px; padding: 5px 6px 5px 11px; border-bottom: 1px solid var(--border); box-shadow: inset 3px 0 0 var(--stripe); }
[data-mea-column] > header > p { min-height: 1lh; margin: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--text-2xs); color: var(--muted-foreground); }
[data-mea-column] > header > div { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--text-sm); }
[data-mea-column] > header > div > span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 550; }
[data-mea-column] > header button { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 3px 5px; border-radius: calc(var(--radius) - 4px); font-size: var(--text-xs); color: var(--muted-foreground); }
[data-mea-column] > header button:hover { background: var(--accent); color: var(--foreground); }
[data-mea-column] > header [data-icon="CircleQuestion"] { color: var(--warning); }
[data-mea-column] > header [data-icon="Circle"][aria-label="Unread reply"] { width: 6px; height: 6px; margin: 0 4px; border-radius: 50%; background: var(--foreground); }
[data-mea-column] > header [data-icon="Circle"][aria-label="Unread reply"] > * { display: none; }
[data-mea-column] > header [data-icon="Check"] { flex: none; width: 14px; height: 14px; color: var(--success); }
[data-mea-column] > header [data-mea-more] { flex: none; font-size: var(--text-xs); color: var(--muted-foreground); cursor: default; }
[data-mea-column] > section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
[data-sidebar-rename-row][data-mea-current], [data-sidebar-rename-row][data-mea-current]:hover { background-color: var(--state-active); }
[data-sidebar-sticky-tier][data-mea-current] { background-image: linear-gradient(var(--state-active), var(--state-active)), linear-gradient(var(--sidebar), var(--sidebar)); }
@media ${COMPACT} {
  [data-mea-columns] { scroll-snap-type: x mandatory; }
  [data-mea-column], [data-mea-column][data-anchor] { width: 100%; scroll-snap-align: start; }
}
`;

// The anchors of the columns pages on screen, newest last; its sidebar row looks current.
const anchors: string[] = [];
const anchorListeners = new Set<() => void>();
const columnsAnchor = () => anchors.at(-1) ?? null;
function subscribeColumnsAnchor(listener: () => void) {
  anchorListeners.add(listener);
  return () => {
    anchorListeners.delete(listener);
  };
}
function showAnchor(id: string) {
  anchors.push(id);
  anchorListeners.forEach((listener) => listener());
  return () => {
    anchors.splice(anchors.lastIndexOf(id), 1);
    anchorListeners.forEach((listener) => listener());
  };
}

/** The column holding `node`, among the page's columns in `root`. */
function columnOf(root: HTMLElement | null, node: EventTarget | null) {
  const column = node instanceof Element ? node.closest<HTMLElement>("[data-mea-column]") : null;
  return column && root?.contains(column) ? (column.dataset.meaColumn ?? null) : null;
}

/** A thread "Open" asked for; the next navigation to it shows it plainly. */
let plainOpen: string | null = null;

function readSuppressed(threadId: string): string[] | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(SUPPRESS + threadId) ?? "null");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

/**
 * Opening a thread with eligible descendants shows its columns instead, once
 * per navigation and only when the data it needs arrives within about 3s.
 */
export function SubthreadColumnsAutoOpen() {
  const { threadId } = useBbContext();
  const navigate = useBbNavigate();
  const { status, threads } = useSidebarThreads();
  const { attention, loaded } = useAttention();
  const settings = useSettings();
  const split = useSidebarSplitLayout();
  const layout = useRef(split);
  layout.current = split;
  const panes = useRef<ReadonlySet<string>>(new Set());
  const pending = useRef<{ id: string; inPane: boolean } | null>(null);
  const current = useSyncExternalStore(subscribeColumnsAnchor, columnsAnchor);

  // The anchor of the columns page on screen looks like BB's own current row, also after the sidebar re-renders it.
  useEffect(() => {
    if (!current) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      // From the link up: a section's sticky group carries the row attribute too.
      for (const link of document.querySelectorAll<HTMLElement>("a[data-sidebar-thread-id]")) {
        const row = link.closest<HTMLElement>(ROW);
        if (row && row.hasAttribute("data-mea-current") !== (link.dataset.sidebarThreadId === current)) row.toggleAttribute("data-mea-current");
      }
    };
    const touchesSidebar = (node: Node) => node instanceof Element && (node.closest(ROW) !== null || node.querySelector(ROW) !== null);
    const observer = new MutationObserver((records) => {
      if (!frame && records.some((record) => touchesSidebar(record.target) || [...record.addedNodes].some(touchesSidebar))) frame = requestAnimationFrame(sync);
    });
    observer.observe(document.body, { subtree: true, childList: true });
    sync();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const row of document.querySelectorAll("[data-mea-current]")) row.removeAttribute("data-mea-current");
    };
  }, [current]);

  useEffect(() => {
    const change = routeChange(panes.current, threadId, layout.current?.panes.map((pane) => pane.threadId) ?? []);
    panes.current = change.panes;
    pending.current = null;
    if (!threadId) return;
    if (plainOpen === threadId) {
      plainOpen = null;
      return;
    }
    pending.current = { id: threadId, inPane: change.inPane };
    const timer = setTimeout(() => (pending.current = null), 3000);
    return () => clearTimeout(timer);
  }, [threadId]);

  useEffect(() => {
    const request = pending.current;
    if (!request || status !== "ready" || !loaded || settings.isLoading) return;
    pending.current = null;
    const suppressed = readSuppressed(request.id);
    const open = shouldAutoOpen({
      setting: settings.values?.columns,
      compact: matchMedia(COMPACT).matches,
      inPane: request.inPane,
      eligible: eligibleIds(request.id, threads, attention),
      suppressed,
    });
    if (!open) return;
    if (suppressed) sessionStorage.removeItem(SUPPRESS + request.id);
    navigate.toPluginPanel(COLUMNS_PATH, { subPath: request.id, replace: true });
  });

  return <style>{COLUMNS_CSS}</style>;
}

export function SubthreadColumnsPage({ subPath }: PluginNavPanelProps) {
  const anchorId = subPath.split("/")[0] ?? "";
  const { status, threads } = useSidebarThreads();
  const { attention, loaded } = useAttention();
  const anchor = threads.find((thread) => thread.id === anchorId && !thread.isHidden) ?? null;
  const shownId = anchor?.id ?? null;
  // BB has no open thread on a plugin page, so the page applies the open-thread rule to its anchor.
  useSeenWhileShown(shownId, attention);
  useEffect(() => (shownId ? showAnchor(shownId) : undefined), [shownId]);
  if (!anchor) return status === "loading" ? null : <p data-mea-columns-hint="">Open a thread whose subthreads need you to see them here.</p>;
  return <Columns key={anchor.id} anchor={anchor} threads={threads} attention={attention} loaded={loaded} />;
}

function Columns(props: { anchor: PluginSidebarThread; threads: readonly PluginSidebarThread[]; attention: ReadonlyMap<string, Attention>; loaded: boolean }) {
  const { anchor, threads, attention } = props;
  const seen = useMarkSeen();
  const navigate = useBbNavigate();
  const limit = columnLimit(useSettings().values?.maxColumns);
  const scroller = useRef<HTMLDivElement>(null);
  const [{ columns, more }, setLayout] = useState<Layout>(() => nextColumns(NO_COLUMNS, anchor.id, threads, attention, { limit }));
  // Columns from the first snapshot are not news; later ones get a short highlight.
  const initial = useRef(new Set(columns.map((column) => column.id)));
  if (!props.loaded) for (const column of columns) initial.current.add(column.id);
  const engagedRef = useRef<string | null>(null);
  const [engaged, setEngaged] = useState<string | null>(null);
  const [near, setNear] = useState<ReadonlySet<string>>(() => new Set());
  const [observer, setObserver] = useState<IntersectionObserver | null>(null);
  const latest = useRef({ threads, attention });
  latest.current = { threads, attention };
  const view = useRef<{ id: string; x: number } | null>(null);

  useEffect(() => {
    // The columns he is in: clicked, or holding focus after Tab.
    const held = [engagedRef.current, columnOf(scroller.current, document.activeElement)];
    setLayout((prev) => {
      // Until the plugin's records arrive, failures and results are not known yet.
      const shown = props.loaded ? prev : { columns: prev.columns.filter((column) => held.includes(column.id)), more: [] };
      return settle(prev, nextColumns(shown, anchor.id, threads, attention, { limit, held }));
    });
  }, [anchor.id, threads, attention, engaged, limit, props.loaded]);

  // ThreadChat mounts once its column comes within about one column of the viewport, and stays.
  useLayoutEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const ids = entries.flatMap((entry) => (entry.isIntersecting ? [(entry.target as HTMLElement).dataset.meaColumn ?? ""] : []));
        if (ids.length) setNear((prev) => (ids.every((id) => prev.has(id)) ? prev : new Set([...prev, ...ids])));
      },
      { root: scroller.current, rootMargin: "0px 480px" },
    );
    setObserver(io);
    return () => io.disconnect();
  }, []);

  // The leftmost visible column keeps its screen position when columns come or go before it.
  const remember = () => {
    const root = scroller.current;
    const first = root && [...root.children].find((el): el is HTMLElement => el instanceof HTMLElement && el.offsetLeft + el.offsetWidth > root.scrollLeft + 1);
    view.current = root && first ? { id: first.dataset.meaColumn ?? "", x: first.offsetLeft - root.scrollLeft } : null;
  };
  const restore = () => {
    const root = scroller.current;
    const at = view.current;
    const column = root && at && [...root.children].find((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.meaColumn === at.id);
    if (root && at && column) root.scrollLeft = column.offsetLeft - at.x;
  };
  useLayoutEffect(() => {
    restore();
    remember();
  }, [columns]);

  // Seen: he clicked into a descendant's column and then clicked or focused anything else, or left the page.
  useEffect(() => {
    const root = scroller.current;
    const markSeen = (id: string) => {
      const { threads, attention } = latest.current;
      const thread = threads.find((candidate) => candidate.id === id);
      const at = thread ? seenMark(thread, attention.get(id)) : 0;
      if (at > (attention.get(id)?.seenAt ?? 0)) seen(id, at);
    };
    let tabAt = -Infinity;
    let key = { column: null as string | null, at: -Infinity };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") tabAt = event.timeStamp;
      key = { column: columnOf(root, event.target), at: event.timeStamp };
    };
    const onEvent = (event: Event) => {
      if (!root || !(event.target instanceof Element)) return;
      const column = event.target.closest<HTMLElement>("[data-mea-column]");
      // The scroller's own scrollbar and layers opened from a column leave nothing.
      const target = column && root.contains(column) ? (column.dataset.meaColumn ?? null) : event.target === root || event.target.closest(FLOATING) ? undefined : null;
      const stolen =
        event instanceof FocusEvent &&
        isStolenFocus({
          engaged: engagedRef.current,
          target,
          anchorId: anchor.id,
          editable: event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.matches("input, textarea, select")),
          afterTab: event.timeStamp - tabAt < 300,
          keyColumn: event.timeStamp - key.at < 1000 ? key.column : null,
        });
      if (stolen) {
        const back = event.relatedTarget;
        if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
        else if (event.target instanceof HTMLElement) event.target.blur();
        // It also scrolled itself into view, before its scroll event could update the remembered view.
        restore();
        return;
      }
      const next = engage(engagedRef.current, target, anchor.id, event.type === "pointerdown" ? "pointer" : "focus");
      if (next.leave) markSeen(next.leave);
      if (next.engaged === engagedRef.current) return;
      engagedRef.current = next.engaged;
      setEngaged(next.engaged);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onEvent, true);
    document.addEventListener("focusin", onEvent, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onEvent, true);
      document.removeEventListener("focusin", onEvent, true);
      if (engagedRef.current) markSeen(engagedRef.current);
    };
  }, [seen, anchor.id]);

  const onlyThisThread = useCallback(() => {
    sessionStorage.setItem(SUPPRESS + anchor.id, JSON.stringify(eligibleIds(anchor.id, latest.current.threads, latest.current.attention)));
    navigate.toThread(anchor.id);
  }, [anchor.id, navigate]);
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const glyph = (thread: PluginSidebarThread | undefined) => {
    const state = thread && rowAttention(thread, [thread], attention);
    return state ? { indicator: state.quiet ? "none" : thread.indicator, rowStatus: state.status } : null;
  };

  return (
    <div ref={scroller} data-mea-columns="" onScroll={remember}>
      <ColumnView id={anchor.id} {...glyph(anchor)} column={null} mounted engaged={false} fresh={false} observer={observer} more={more} onlyThisThread={onlyThisThread} />
      {columns.map((column) => (
        <ColumnView
          key={column.id}
          id={column.id}
          {...glyph(byId.get(column.id))}
          column={column}
          mounted={near.has(column.id)}
          engaged={engaged === column.id}
          fresh={!initial.current.has(column.id)}
          observer={observer}
        />
      ))}
    </div>
  );
}

/** Kept apart so a change in its header or the sidebar never re-renders a chat. */
const Chat = memo(function Chat({ threadId }: { threadId: string }) {
  // Compact keeps the composer and follows the newest message.
  return <ThreadChat threadId={threadId} variant="compact" layout="contained" />;
});

/** Props are plain values or stable objects, so a column re-renders only when its own state changes. */
const ColumnView = memo(function ColumnView(props: {
  id: string;
  /** Absent once the thread is gone. */
  indicator?: PluginSidebarThread["indicator"];
  rowStatus?: PluginComposerThreadRowStatus | null;
  /** Null for the anchor. */
  column: Column | null;
  mounted: boolean;
  engaged: boolean;
  fresh: boolean;
  observer: IntersectionObserver | null;
  /** The anchor's: eligible descendants without a column. */
  more?: Layout["more"];
  onlyThisThread?: () => void;
}) {
  const { id, indicator, column, mounted, observer, more, onlyThisThread } = props;
  const navigate = useBbNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!observer || !el || mounted) return;
    observer.observe(el);
    return () => observer.unobserve(el);
  }, [observer, mounted]);

  const open = () => {
    plainOpen = id;
    navigate.toThread(id);
  };
  return (
    <div
      ref={ref}
      data-mea-column={id}
      data-anchor={column ? undefined : ""}
      data-hue={column ? ((column.depth - 1) % 6) + 1 : undefined}
      data-done={column?.done ? "" : undefined}
      data-engaged={props.engaged ? "" : undefined}
      data-fresh={props.fresh ? "" : undefined}
    >
      <header>
        {/* The anchor's empty path line keeps every header the same height. */}
        <p title={column?.path.join(" › ")}>{column && `${column.path.join(" › ")} ›`}</p>
        <div>
          {indicator && <ThreadStatusGlyph indicator={indicator} rowStatus={props.rowStatus ?? null} size="compact" />}
          <span>{indicator ? <ThreadTitle threadId={id} /> : column?.title}</span>
          {column?.done && <Icon name="Check" aria-label="Done" />}
          {more && more.length > 0 && (
            <small data-mea-more="" title={more.map((entry) => entry.title).join("\n")}>
              +{more.length} more
            </small>
          )}
          {onlyThisThread && (
            <button type="button" onClick={onlyThisThread}>
              Only this thread
            </button>
          )}
          <button type="button" aria-label="Open" title="Open" onClick={open}>
            <Icon name="ArrowUpRight" fallback="ChevronRight" />
          </button>
        </div>
      </header>
      <section>{mounted && <Chat threadId={id} />}</section>
    </div>
  );
});
