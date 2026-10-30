import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { experimental_useRpcQuery as useRpcQuery, useSdk } from "@get-bb/plugin-sdk/app";
import { withSeen, type Attention } from "./attention";
import { RESPONSIBILITIES, contract } from "./contract";

/** `loaded`: Responsibilities answered, or it is not there and only BB's own data counts. */
export type AttentionState = { attention: ReadonlyMap<string, Attention>; loaded: boolean };

/** The seen marks this browser made: without Responsibilities they keep a seen failure out of the columns. */
const SEEN = "subthread-columns/seen";
let seenRaw: string | null = null;
let seenMarks: Readonly<Record<string, number>> = {};

function localSeen() {
  const raw = localStorage.getItem(SEEN);
  if (raw !== seenRaw) {
    seenRaw = raw;
    seenMarks = JSON.parse(raw ?? "{}");
  }
  return seenMarks;
}

// Other windows report a change as a storage event; this one dispatches its own.
function subscribeSeen(listener: () => void) {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/**
 * Responsibilities' records with this browser's seen marks. BB keeps the last
 * snapshot while a read fails, and reads again on the `attention` tag and on
 * reconnect.
 */
export function useAttention(): AttentionState {
  const list = useRpcQuery({ contract, pluginId: RESPONSIBILITIES, method: "list", input: {} });
  const seen = useSyncExternalStore(subscribeSeen, localSeen);
  const attention = useMemo(() => withSeen(list.data, seen), [list.data, seen]);
  // Without Responsibilities every later read loads again; what the page settled on stays.
  const loaded = useRef(false);
  if (!list.isLoading) loaded.current = true;
  return { attention, loaded: loaded.current };
}

/**
 * Records a seen mark in this browser, and in Responsibilities when it runs.
 * The local write keeps the larger of its mark and the one it read; another
 * window writing at the same moment can still overwrite it.
 */
export function useMarkSeen() {
  const sdk = useSdk();
  return useCallback(
    (threadId: string, resultAt: number) => {
      if ((localSeen()[threadId] ?? 0) < resultAt) {
        localStorage.setItem(SEEN, JSON.stringify({ ...localSeen(), [threadId]: resultAt }));
        window.dispatchEvent(new StorageEvent("storage", { key: SEEN }));
      }
      // A plain call, so a missing Responsibilities raises no error toast; its contract invalidates `attention`.
      sdk.plugins.callRpc({ pluginId: RESPONSIBILITIES, method: "seen", input: { threadId, resultAt }, outputSchema: contract.seen.output }).catch(() => {});
    },
    [sdk],
  );
}

/** Seen: the thread is shown in a visible, focused window when its result arrives or later. */
export function useSeenWhileShown(threadId: string | null, attention: ReadonlyMap<string, Attention>) {
  const markSeen = useMarkSeen();
  useEffect(() => {
    const record = threadId ? attention.get(threadId) : undefined;
    const resultAt = record?.resultAt;
    if (!record || !resultAt || (record.seenAt ?? 0) >= resultAt) return;
    const mark = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      markSeen(record.threadId, resultAt);
    };
    mark();
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [markSeen, threadId, attention]);
}
