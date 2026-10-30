import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    columns: {
      type: "select",
      label: "Subthread columns",
      description:
        "Auto shows a thread whose subthreads wait for your answer, failed or hold an unread result as columns: the thread, then each such subthread. Working subthreads get none. Unread results need the Responsibilities plugin. Off keeps the plain thread view.",
      options: ["auto", "off"],
      experimental_optionLabels: { auto: "Open automatically", off: "Off" },
      default: "auto",
    },
    maxColumns: {
      type: "number",
      label: "Subthread columns limit",
      description:
        "The most subthread columns a page shows, besides the thread itself. When more need you, those waiting for your answer come first, then failed ones, then unread results, newest first; the rest show as +N more.",
      default: 8,
      experimental_schema: z.number().int().min(1),
    },
  });
}
