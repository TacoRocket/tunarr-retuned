# Server settings

Environment variables the fork adds or changes. Everything else is in [Tunarr's list](https://tunarr.com/getting-started/run/).

| Variable | CLI | Default | What it does |
| --- | --- | --- | --- |
| `TUNARR_WORKER_POOL_SIZE` | N/A | CPU count, up to 8 | Maximum number of scheduling workers running at once. Recommended: no more than the number of CPUs on the host. |
| `TUNARR_PLEX_SCAN_METADATA_BATCH_SIZE` | N/A | `1` | Opt in with `20` to fetch Plex movie and episode metadata in groups. Integers above 100 are capped at 100; invalid values and values below 2 use individual requests. Restart Tunarr after changing this setting. |
| `TUNARR_PLEX_NOTIFICATIONS` | N/A | `false` | Sets the initial Plex notification preference. The saved choice in **Settings → Media Sources** takes precedence after setup. |

The worker pool keeps slot scheduling off the server's main thread. Scheduling workers start when they are needed and stop after a minute with no work, so the first scheduling request after a quiet spell can take about a second longer. A worker only stops once its queued and running jobs have finished. Active playback uses separate FFmpeg processes. The implementation is in `server/src/services/TunarrWorkerPool.ts`.


## Plex scan batching

Batching reduces the number of requests Tunarr makes to Plex during a library scan. Set `TUNARR_PLEX_SCAN_METADATA_BATCH_SIZE=20` and restart Tunarr to try it. Leave it unset or set it to `1` to keep individual requests.

The scanner still walks the full library and requests the same metadata, including chapters and markers. Show and season relationships, path filters, and force-scan behavior stay the same. Failed batches and missing or unconvertible items fall back to individual requests. A failed batch adds a request and delay before recovery. Cancellation stops further batches but does not interrupt a request already in flight.

In one copied-data comparison on Bun 1.4.4 and Meilisearch 1.52.4, an incremental scan of 1,418 movies finished in 20.2 seconds with batches of 20, compared with 31.7 seconds using individual requests. Catalog contents matched. Peak container anonymous memory rose from 367 to 405 MiB; 20 seconds after completion it was 301 versus 309 MiB.

That was one sequential comparison of a mostly unchanged movie library, not a full reindex or TV-library benchmark. Plex caching and library contents affect the result. Batching is an opt-in speed setting and can use more memory; it does not add indexing pacing or a separate post-scan indexing phase.


## Plex notifications

Plex notifications refresh changed movies and TV shows between scans, and let the next normal scan reuse successful item refreshes. In **Settings → Media Sources**, choose **Add → Plex (Auto)** to sign in and discover your server, or **Plex (Manual)** to enter its URL and access token. Select the movie or TV libraries to import in the library picker. For an existing server, use **Edit Libraries**.

Turn on **Refresh libraries when Plex reports changes** on the same page. The switch saves immediately and applies to all enabled, available Plex movie and TV libraries. You can turn it on before adding Plex. Tunarr checks for newly eligible sources every 30 seconds. Turning it off disconnects the listeners; scheduled scans continue.

The switch starts off unless `TUNARR_PLEX_NOTIFICATIONS=true` was set when Tunarr first initialized the preference. Once saved, the UI choice survives restarts, including when Compose still sets the variable.

A completed movie or episode notification refreshes that item through the existing importer and search index, reusing the full metadata fetched to identify it. Episodes use their saved show and season links, including season zero/specials. Missing or inconsistent parents fall back to discovery of the affected show. Show and season notifications still refresh that show's seasons and episodes. Repeated events are coalesced for five seconds. Refreshes share the normal scan queue and library locks, and retain subtitle handling, duration reconciliation, trash repair, and smart filler synchronization.

Notification batches share the follow-up duration reconciliation, trash repair and smart filler synchronization instead of scheduling all three after every item. Cleanup is queued when the batch ends, or within five seconds of the first completed refresh if the batch is still running. Later items do not reset that timer. Completed work still gets cleanup when the batch stops early. These updates can therefore wait briefly after an import; existing task queues and search-index waits can delay completion further. Ordinary library scans keep their existing cleanup behavior.

If a scheduled or manual full-library scan arrives while a notification holds that library's lock, it waits for the notification to finish and then joins the scan queue. The request is acknowledged as accepted without waiting for the notification; the full scan keeps its reserved turn. A targeted program or show rescan retains the existing busy/error response and cannot claim that reserved turn. Duplicate full scans remain rejected while one is waiting, queued or running.

After an item is successfully imported or confirmed unchanged using full metadata, Tunarr keeps a small, one-use acknowledgement. The next ordinary scan still lists the library for additions and deletions, but skips that item's full-detail request if its saved metadata and selected listing fields still match. Batching also excludes those items from detail requests. Failed imports do not earn an acknowledgement. Forced scans always fetch details; collections, show/season traversal, and uncovered items keep their existing scan behavior.

An item event outside the scan-echo window discards only that item’s acknowledgement. Library scan activity, deletion events, and show/season refreshes discard acknowledgements for the library; a disconnect discards them for the source. Reconnecting does not replay missed events or start an extra full scan. Connections retry within 30 seconds, and source, credential, or library availability changes are picked up on the same interval. Acknowledgements are held in memory, capped at 10,000 items, and disappear on restart or eviction; all of those cases restore normal detail reads.

Keep normal scans enabled. Plex listings omit streams and markers, and the trial did not establish complete intro/credits marker notification coverage. Reuse lasts for one scan only: a change without a usable event can wait until the following scan, one interval longer than scans alone. The comparison checks title, year, duration, summary, file location, and episode number. Changes outside that comparison, such as tags, can also wait one extra scan; an invalidating event restores the normal read. A sidecar subtitle addition in the Plex trial emitted library activity rather than an item notification; that activity restores normal detail reads.

Plex metadata reads can themselves emit notifications. Tunarr ignores timeline echoes for a library while it is scanning or handling a notification, and for five seconds after a notification refresh. Deletion events and library scan activity still invalidate acknowledgements during that window. An indistinguishable detail-only change during the window has the same one-extra-scan limit. The pending queue holds at most 100 distinct items; excess events and failed refreshes defer to normal scans. Disconnects and failed refreshes are logged.

Known movies and episodes need one metadata request per notification refresh, replacing their detail request in the next normal scan. Show/season events and parent discovery cost more because they walk the affected show. Repeated notifications and other background activity can also add requests, so this does not promise lower total daily work than scans alone. Notifications provide earlier updates; batching separately reduces request count during scans.

## Daily library scan time

To run automatic library scans once a day, open **Settings → Scanner**, turn on **Scan once a day at a set time**, pick the time and time zone, and save. The time zone starts as your browser's, and the new time applies without a restart. The same fields are `dailyScanTime` and `dailyScanTimeZone` on `PUT /api/settings/media-source`.

The earlier `TUNARR_LIBRARY_SCAN_DAILY_TIME` and `TUNARR_LIBRARY_SCAN_TIME_ZONE` container variables are no longer read. If you set them, enter the same time on the Scanner page and remove them from your Compose file; until then, scans follow the interval.

A daily time overrides `rescanIntervalHours` for library scans only. Channel schedules, collection and custom-show sync, hourly library refresh, and the container timezone keep their existing behavior. Manual scans remain available. Prefer `HH:30` (for example, 03:30 Chicago with a UTC container) to retain the existing half-hour separation from the hourly library refresh. Any valid `HH:mm`, including 03:00, is supported, but top-of-hour scans start alongside that refresh. The offset is not a completion guarantee; the daily option does not serialize those jobs.

The time must be 24-hour `HH:mm` and the timezone must be an IANA name. Both values are required together, and the Scanner page refuses an invalid or partial pair when you save. With neither set, the existing interval and half-hour offset remain unchanged.

The existing `node-schedule` calendar rule follows the selected timezone through daylight saving changes: 03:00 in Chicago is 08:00 UTC in summer and 09:00 UTC in winter. Times skipped by a spring clock change have no invocation that day; repeated fall times follow `node-schedule` behavior. Choose a time such as 03:00 outside that transition window. Missed scans while Tunarr is stopped are not replayed.
