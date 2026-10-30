# Migrate from Thread Columns 0.6.0

Thread Columns 0.6.0 uses the stable ID `model-effort-badges`. Version 0.7.0 keeps that ID for **badges only**. Columns move to **Subthread Columns 0.1.0**, ID `subthread-columns`, installed separately.

1. **Before updating**, run `bb plugin config model-effort-badges` and record your actual `columns`, `maxColumns` and `placement`. Do not replace them with defaults. For example, if your settings are `columns=off`, `maxColumns=3`, `placement=beside`, keep those exact values.
2. For a pinned npm/Git source or a source change, disable and remove the old registration, then install the two published versions. In BB 0.47.1 removal resets the plugin settings but leaves its attention database intact:

   ```sh
   bb plugin disable model-effort-badges
   bb plugin remove model-effort-badges
   bb plugin install 'git:https://github.com/neoromantic/bb-plugin-model-effort-badges.git@semver:^0.7.0' --yes
   bb plugin install 'git:https://github.com/neoromantic/bb-plugin-subthread-columns.git@semver:^0.1.0' --yes
   ```

3. Restore the recorded `columns` and `maxColumns` under `subthread-columns` and `placement` under `model-effort-badges`. The following commands apply **only to the example above**; use your own recorded values:

   ```sh
   bb plugin config subthread-columns set columns off
   bb plugin config subthread-columns set maxColumns 3
   bb plugin config model-effort-badges set placement beside
   ```

4. Check both plugins' settings against the values recorded before removal. For a normal tracking-source update, settings are retained; restore only an individual value that differs.

## Page and browser choices

Column pages move from `/plugins/model-effort-badges/columns/<thread id>` to `/plugins/subthread-columns/columns/<thread id>`. The browser session namespace changes too: an old **Only this thread** choice does not migrate. The new namespace starts with no such choices.

## Attention and sidebar features

0.7.0 leaves the old attention database intact and does not open it. Subthread Columns does not import that database or track unread results itself. Without Responsibilities it uses BB's waiting/pending-interaction and failed-thread data. Click-and-leave seen marks are local to the browser, not synchronized across devices; concurrent windows can overwrite a local mark and show a failure again. New results are not hidden by an older mark. If Responsibilities becomes unavailable after a successful read, its last snapshot remains until reload.

[Responsibilities](https://github.com/neoromantic/bb-plugin-responsibilities) is a separate optional plugin. Install it with `bb plugin install 'git:https://github.com/neoromantic/bb-plugin-responsibilities.git@semver:^0.1.0' --yes`. It owns takeover of the old attention records, sidebar status marks, unread-result tracking, manager styling and **New child thread**. Back up your BB data before changing plugins. Run only one attention writer: disable the combined 0.6.0 plugin or update it to badges-only 0.7.0 before enabling Responsibilities. Do not delete the old database to complete this migration. Responsibilities merges result, quiet-attention and seen fields by their maximum from a temporary copy on each start, leaving the source intact; unconfirmed client marks may repeat. After a source database change it scans completed thread history for missed results. No Responsibilities installation is required for standalone waiting/failed columns.

When Responsibilities is installed, replace only the old `model-effort-badges/newChildThread` entry in your existing `rowActions` list with `responsibilities/newChildThread`, preserving every other entry and its position. Do not replace the whole list with an example. Manager styling also moves there: its **Managers file** setting takes an absolute path to a user-owned JSON file with shape `{"managers":[{"threadId":"example-thread-id"}]}` instead of using the old title prefix. There is no default file path. Configure only the relevant setting; do not overwrite your other settings.
