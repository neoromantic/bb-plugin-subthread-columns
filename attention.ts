import type { PluginComposerThreadRowStatus, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** What Responsibilities recorded for a thread (epoch ms, null when never). */
export type Attention = {
  threadId: string;
  /** When the last finished run wrote visible assistant output. */
  resultAt: number | null;
  /** A root's `latestAttentionAt` from a finished run without output. */
  quietAttentionAt: number | null;
  /** The newest `resultAt` a user had open in a visible, focused window. */
  seenAt: number | null;
};

export type AttentionThread = Pick<
  PluginSidebarThread,
  "id" | "parentThreadId" | "status" | "isUnread" | "lastReadAt" | "latestAttentionAt" | "indicator"
>;

/** The row glyph of an unread thread that shows nothing else; styled as a dot. */
export const UNREAD: PluginComposerThreadRowStatus = { icon: "Circle", label: "Unread reply" };
export const FAILED: PluginComposerThreadRowStatus = { icon: "CircleX", tone: "error", label: "Thread failed" };
export const COLLAPSED_FAILED: PluginComposerThreadRowStatus = { ...FAILED, label: "A collapsed thread failed" };

/** Every field only grows on the server, so the larger value is always the newer one. */
export function merge(known: Attention | undefined, next: Attention): Attention {
  const max = (a: number | null | undefined, b: number | null) => (a != null && (b === null || a > b) ? a : b);
  return {
    threadId: next.threadId,
    resultAt: max(known?.resultAt, next.resultAt),
    quietAttentionAt: max(known?.quietAttentionAt, next.quietAttentionAt),
    seenAt: max(known?.seenAt, next.seenAt),
  };
}

/** Responsibilities' records, none without it, with the seen marks this browser made over them. */
export function withSeen(rows: readonly Attention[] | undefined, seen: Readonly<Record<string, number>>): ReadonlyMap<string, Attention> {
  const attention = new Map(rows?.map((row) => [row.threadId, row]));
  for (const [threadId, seenAt] of Object.entries(seen)) attention.set(threadId, merge(attention.get(threadId), { threadId, resultAt: null, quietAttentionAt: null, seenAt }));
  return attention;
}

/**
 * Unread means a result nobody has looked at: newer than BB's own read mark
 * (roots) and the plugin's seen mark (all threads). A root's native unread
 * still counts, unless the plugin saw that its latest attention came from a
 * run without output.
 */
export function isUnread(thread: AttentionThread, attention: Attention | undefined): boolean {
  if (attention?.resultAt != null && attention.resultAt > Math.max(thread.lastReadAt ?? 0, attention.seenAt ?? 0)) return true;
  return thread.parentThreadId === null && thread.isUnread && thread.status !== "error" && thread.latestAttentionAt !== attention?.quietAttentionAt;
}

export type RowAttention = { status: PluginComposerThreadRowStatus | null; failed: boolean; unread: boolean; quiet: boolean };

/** Glyphs BB's collapsed parent takes over from its hidden descendants. */
const COLLAPSED_ACTIVITY = new Set(["waiting-for-input", "working-draft", "workflow", "background-agent", "background-command", "plan-mode", "goal", "runtime"]);

/**
 * One row: the thread itself plus, for a collapsed parent, its hidden
 * descendants. A failure shows the red cross. An unread result shows a dot:
 * as the row glyph when BB would show nothing else, otherwise over BB's glyph.
 * BB ignores a row status while its spinner or question shows, so `failed`
 * lets the stylesheet draw the cross there.
 */
export function rowAttention(
  thread: AttentionThread,
  group: readonly AttentionThread[],
  attention: ReadonlyMap<string, Attention>,
): RowAttention {
  const unread = group.some((member) => isUnread(member, attention.get(member.id)));
  const failure = thread.status === "error" ? FAILED : group.some((member) => member.status === "error") ? COLLAPSED_FAILED : null;
  const bbGlyph =
    !(thread.indicator === "none" || thread.indicator === "unread-success") ||
    group.some((member) => member !== thread && COLLAPSED_ACTIVITY.has(member.indicator));
  const status = failure ?? (unread && !bbGlyph ? UNREAD : null);
  return { status, failed: failure !== null, unread, quiet: !unread && thread.indicator === "unread-success" };
}
