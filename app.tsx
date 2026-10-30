import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { COLUMNS_PATH, SubthreadColumnsAutoOpen, SubthreadColumnsPage } from "./columns-view";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "subthread-columns", component: SubthreadColumnsAutoOpen });
  app.slots.navPanel({ id: "columns", title: "Subthreads", icon: "Columns2", path: COLUMNS_PATH, component: SubthreadColumnsPage });
});
