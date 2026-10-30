import { z } from "zod";

/** The plugin that keeps the attention records; its contract's `list` and `seen` as it serves them. */
export const RESPONSIBILITIES = "responsibilities";

export const contract = {
  list: {
    input: z.object({}),
    output: z.array(z.object({ threadId: z.string(), resultAt: z.number().nullable(), quietAttentionAt: z.number().nullable(), seenAt: z.number().nullable() })),
    tags: () => ["attention"],
  },
  seen: { input: z.object({ threadId: z.string(), resultAt: z.number() }), output: z.null(), invalidates: () => ["attention"] },
};
