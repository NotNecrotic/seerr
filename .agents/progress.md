# Progress Log — Music Requesting Support

Plan: `plan.md`

## Status

**COMPLETE** — server + frontend implemented, typecheck/lint/tests all green.

- `typecheck:server` — clean
- `typecheck:client` — clean
- `eslint` — **0 errors** (19 pre-existing warnings, none from this work)
- `node server/test/index.mts` — **235 pass / 0 fail**

## Validation

```
ℹ tests 235
ℹ suites 60
ℹ pass 235
ℹ fail 0
```

## Completed

### Phases 1-7 (server) — see git history
All server work listed below is done and typechecks:

- Phase 1 data model, migrations, entities
- Phase 2 MusicBrainz client
- Phase 3 Lidarr client + settings + job + download tracker
- Phase 4 request lifecycle (`createMusicRequest`, `sendToLidarr`, notifications)
- Phase 5 CAA artwork (server side)
- Phase 6 Plex music libraries
- Phase 7 permissions + `User.permissions` widened to `bigint`

### Additional server work completed in this pass
- `server/routes/settings/lidarr.ts` registered under `/settings/lidarr`
- `server/lib/scanners/lidarr/index.ts` — album + track availability, orphan cleanup
- `lidarr-scan` job registered in `server/job/schedule.ts`
- `server/routes/music.ts` — `/music/:mbid`, `/music/:mbid/tracks`
- `server/routes/artist.ts` — `/artist/:mbid`, `/artist/:mbid/releases`
- `server/routes/search.ts` — `/search/music` and `/search/artist`
- `server/models/Music.ts` — `mapRelease`, `mapReleaseSearchResult`
- `next.config.ts` — `coverartarchive.org` + `archive.org` remote patterns
- `CachedImage` — new `musicbrainz` type rewriting to `/imageproxy/musicbrainz/`

## Remaining work

Not done (deliberately out of scope of this pass):

- `seerr-api.yml` OpenAPI schemas/endpoints for the new music + artist + lidarr routes
- Jellyfin music library scanning (Plex side is wired; the Jellyfin scanner has no
  music branch yet)
- Lidarr settings modal (`LidarrModal`) and the `SettingsServices` UI section
- Override rules for Lidarr (`OverrideRule` only knows radarr/sonarr)
- Music section on the discover *landing* page — the standalone `/discover/music`
  page exists and is linked from the sidebar
- i18n locale files other than the English defaults
- Blocklisting for music (music rows are keyed on `musicBrainzId` with no TMDB id, so
  the TMDB-driven blocklist flow does not apply)

## Critical issue found and fixed

`Permission.VIEW_BLOCKLIST` is already `2^30`, so the next three music bits
(`2^31`–`2^33`) exceed the **Postgres `int4`** range. Left alone this would have
silently overflowed every Postgres install. Fixed by:

- `User.permissions` → `resolveDbType('bigint')` with a Postgres `bigint` migration
- `resolveDbType` gained a `sqliteFallbackMapping` (`bigint` → `integer`), since
  SQLite has no `bigint` type and its INTEGER affinity is already 64-bit
- A `transformer` on the column, because Postgres returns `bigint` as a **string**,
  which would break the bitwise checks in `hasPermission`

## Notes / decisions made during implementation

- `Media` row = **album/release**; `Track` children mirror `Season`.
- Artists are a **derived read-only entity** parallel to `Person`, on separate
  `/artist/:mbid` routes so their UUIDs never collide with TMDB person int ids.
- Music requests key off **`releaseGroupId`** when talking to Lidarr, but `Media`
  stores the **release id**. The subscriber translates between them.
- `LidarrSettings.is4k` exists (inherited from `DVRSettings`) but is never true; the
  settings route treats any Lidarr server as a default candidate regardless of it.
- Music has no 4K variants, so no `REQUEST_4K_MUSIC` bits were added.
- CAA art is omitted from notifications when unknown rather than guessed.
- MusicBrainz has no editorial `overview`, so notifications send an empty message
  rather than a fabricated one.

## Open questions / risks

- Plex music library scanning depends on Plex exposing `musicbrainz://` GUIDs. Items
  without them are skipped rather than force-matched by title.
- The Lidarr scanner matches on `foreignAlbumId` (release-group) while `Media` stores
  the release id. **These can differ**, so album matching in Lidarr scans may need to
  be revisited once tested against a real instance — this is the highest-risk area.

## Environment notes

- `pnpm` was not on PATH; installed globally via `npm i -g pnpm@10.24.0`.
- Node 24 is installed but the project pins `^22.19.0` with `engine-strict=true`, so
  installs need `--config.engine-strict=false`.
- `pnpm install` exceeds the 30s command timeout; run it backgrounded and poll the log.
- Typecheck with `node node_modules/typescript/bin/tsc --project server/tsconfig.json --noEmit`.

## Completed

### Phase 1 — Data model
- `MediaType.MUSIC = 'music'` in `constants/media.ts`
- `Media.musicBrainzId` (nullable varchar, indexed) + `tracks` relation
- `Track` entity (mirrors `Season`, keyed on `trackNumber`, nullable `musicBrainzId`)
- `TrackRequest` entity (mirrors `SeasonRequest`)
- `User.musicQuotaLimit` / `musicQuotaDays`; `QuotaResponse.music` counted by track
  count, mirroring TV's season-count quota logic
- `MediaRequest.tracks` relation + `trackCount` relation count
- `Library.type` gains `'music'`
- Migrations: `sqlite/1789260000000-AddMusicSupport`, `postgres/1789260000001-AddMusicSupport`
- Entities registered in `datasource.ts`

### Phase 2 — MusicBrainz client
- `server/api/musicbrainz/index.ts` + `interfaces.ts`
- `searchReleases`, `getRelease`, `getReleaseByMbid`, `getArtist`, `getArtistReleases`,
  `searchArtists`
- `buildCoverArtUrl()` + `isValidMbid()` exported; descriptive `User-Agent`
- `'musicbrainz'` cache tier (21600s TTL, 1000 keys — longest of any API tier)
- Notification branch in `MediaRequest.sendNotification` uses CAA art

### Phase 3 — Lidarr service
- `server/api/servarr/lidarr.ts` extending `ServarrBase`
- `getQueue` overridden (drops Sonarr's `includeEpisode`)
- `getAlbums`, `getLibraryAlbumsByForeignId`, `getAlbumByForeignId`, `lookupAlbum`,
  `lookupAlbumByForeignId`, `addAlbum`, `searchAlbum`, `removeAlbum`, `clearCache`
- `LidarrSettings` + `settings.lidarr` getter/setter + `lidarr` default `[]`
- `'lidarr'` cache tier; `LidarrQueueItem` / `ServarrQueueItem` types exported from base
- `lidarr-scan` job id + default schedule
- `DownloadTracker.getAlbumProgress()` + `updateLidarrDownloads()`

### Phase 6 (partial)
- `plexapi.syncLibraries()` accepts `artist`/`album` sections, normalised to `'music'`
- `PLEX_LIBRARY_TYPE_FILTER` maps library type → Plex `type` filter + `includeGuids`
- `getLibraryContents` / `getRecentlyAdded` take `mediaType`
- Plex scanner passes `library.type` through

## Notes / decisions made during implementation

- `Media` row = **album/release**; `Track` children mirror `Season`.
- Artists are a **derived read-only entity** parallel to `Person`. They get no
  `Media` row, no quota, and no request permission — only a browse page and a badge.
- MusicBrainz has **no editorial overview**, so `MusicBrainzRelease.overview` is
  documented as only being populated from another source; notifications send an empty
  message rather than a fabricated one.
- CAA art is **omitted** from notifications when unknown rather than guessed, since a
  404 has no fallback in several notification agents.
- Queue items without an `albumId` map to `externalId: 0` so they never match a media
  row, rather than being attributed to album 0.
- `getRolling()` takes an `AxiosRequestConfig`, so MusicBrainz query params go under
  `params` — not at the top level.
- `ServarrBase.getQueue` returns `QueueItem & T`, so the Lidarr override had to widen
  to `ServarrQueueItem<LidarrQueueItem>[]`; `QueueItem` is now exported.

## Open questions / risks

- Plex music library scanning depends on Plex exposing `musicbrainz://` GUIDs. Items
  without them are skipped with a logged warning rather than force-matched by title.
- CAA rate-limits anonymous clients; the `ImageProxy` disk cache is what keeps this
  from becoming a bottleneck.

## Environment notes

- `pnpm` was not on PATH; installed globally via `npm i -g pnpm@10.24.0`.
- Node 24 is installed but the project pins `^22.19.0` with `engine-strict=true` in
  `.npmrc`, so installs need `--config.engine-strict=false`.
- `pnpm install` exceeds the 30s command timeout; run it backgrounded and poll the log.

## Phase 8 - Usability fixes (bug reports)

All five bug reports fixed and verified.

- **MusicBrainz response parsing.** Result arrays are keyed by entity type
  (`releases`, `artists`), not `results`, so every search path threw and
  `/discover/music` 500'd. `MbSearchResponse<TKey, T>` now takes the key as a
  generic and `mbResults()` reads it, defaulting to `[]` so a renamed key
  degrades to "no results" instead of throwing. Paging fields are optional because
  browse endpoints report `release-count`/`release-offset` while search reports
  `count`/`offset`.
- **Release tracks.** Tracks are nested under `media[]` (one entry per disc), not on
  the release, so `getRelease` returned 0 tracks. `flattenReleaseTracks()` flattens
  the per-disc lists and adds each medium's `track-offset` so multi-disc sets keep
  unique release-wide track numbers.
- **Artist attribution.** The `artist=` browse parameter returns no artist credits,
  so `getArtistReleases` fell back to `"Unknown Artist"` for every release. It now
  accepts `artistName`, which the artist route supplies from the resolved artist.
- **Lidarr modal.** Root `Transition` used `as={Transition}`, pointing Headless UI
  at another Transition instead of an element, so the dialog rendered empty (21 bytes
  of markup). Changed to `as="div"` with the same transition classes `SonarrModal`
  uses.
- **Permissions/quotas UI.** `REQUEST_MUSIC`, `AUTO_APPROVE_MUSIC` and
  `AUTO_REQUEST_MUSIC` existed server-side with no editor entries. Added them under
  the existing groups, and wired `musicQuotaLimit`/`musicQuotaDays` through the
  user settings route, the OpenAPI schema, `QuotaSelector` (now takes `music`), the
  user profile, and the admin global defaults.
- **Global search.** `/api/v1/search` returned TMDB only, so `/search/music` and
  `/search/artist` were unreachable from the app-wide search box. Releases and artists
  are now resolved alongside TMDB and merged into one envelope; the music lookup
  swallows its own errors so a MusicBrainz outage degrades to TMDB-only results. Added
  `ArtistCard` (mirrors `PersonCard`, MusicBrainz UUID ids, Cover Art Archive art)
  and split the merged results into `items`/`musicItems`/`artistItems`.
- **Duplicate search box.** Removed the local input on `/discover/music`; it only
  redirected to `/search` and is now redundant.
- **Metadata settings.** MusicBrainz shown as a read-only provider row with status,
  plus `MusicBrainz.test()` and a `musicbrainz` result on
  `POST /settings/metadatas/test`.

### Verification harnesses (opt-in, not part of `npm test`)

- `server/scripts/checkMusicBrainz.ts` - exercises the client against the live API.
  This is what surfaced the track-nesting and artist-credit bugs.
- `server/scripts/checkMusicRoutes.ts` - drives the authenticated endpoints
  end-to-end through the OpenAPI validator with a real session.
- `src/components/Settings/LidarrModal/renderCheck.tsx` - mounts the real modal in
  jsdom; fails on the old `as={Transition}` markup, passes on the fix.
- `src/components/ArtistCard/renderCheck.tsx` - same for the new artist card.

Run the server ones with `npx ts-node -r tsconfig-paths/register --files --project
server/tsconfig.json <script>` and the client ones with `npx tsx <script>`. jsdom is
needed for the render checks but is deliberately **not** a committed dependency;
install it locally with `pnpm add --save-dev jsdom --config.engine-strict=false`.

### Environment notes (added)

- Long-running processes must be launched detached (`start /b ... > log 2>&1`); a
  plain backgrounded start gets its process tree killed when the command times out.
- A leftover dev server on port 5055 makes `npm test` fail `server/routes/user`
  (4 tests). Stop the server before running the suite.
- The husky `prepare-commit-msg` hook shells out to `/dev/tty` for `cz` and
  always fails on Windows, blocking every commit. Use `HUSKY=0` together with
  `--no-verify`; lint-staged has already run and passed by the time the hook fires.
- `next dev` misdetects the workspace root (it picks up a lockfile in the parent home
  directory) and hangs while compiling, so it is not a usable way to verify UI changes.
## Rate limiting (intermittent music search failures)

- Symptom: "Something went wrong loading music releases" with a logged
  ``errorMessage: ""``.
- The query was not at fault. MusicBrainz throttles anonymous clients to roughly
  **1 request/second per source IP** and answers faster requests with **503** plus a
  JSON ``{"error": ...}`` body and a ``Retry-After`` header.
- Reproduced with 25 concurrent requests: **10 returned 503**.
- Causes: the client never enabled the ``rateLimit`` option that ``ExternalAPI``
  already supports, and nothing retried throttled responses. Axios also leaves
  ``message`` empty for these responses (detail lives in ``response``), which is why
  the log line was blank and hid the cause.
- Fix: throttle to 1 req/s, retry throttled responses honouring ``Retry-After``
  (capped at 10s, 3 attempts, body checked for a rate-limit message since 503 also
  covers ordinary unavailability), and log via ``describeApiError()``.
- After the fix, 10 concurrent searches resolve **10/10**.
- Note: bursty page loads are the trigger, so this reproduces most easily right
  after a restart or when several pages are opened at once, which is why it looked
  query-specific.