# Task Checklist — Music Requesting Support

Plan: `plan.md` · Progress: `progress.md`

**Legend:** `[x]` done · `[ ]` not done (see "Remaining work" in `progress.md`)

## Phase 1 — Data model
- [x] `MediaType.MUSIC = 'music'` in `constants/media.ts`
- [x] `Media.musicBrainzId` nullable varchar + index
- [x] `Track` entity mirroring `Season`
- [x] `TrackRequest` entity mirroring `SeasonRequest`
- [x] `User.musicQuotaLimit` / `musicQuotaDays` (+ `QuotaResponse.music`)
- [x] `Library.type` gains `'music'`
- [x] SQLite **and** Postgres migrations

## Phase 2 — MusicBrainz API client
- [x] `server/api/musicbrainz/index.ts` + `interfaces.ts`
- [x] Release search, release details w/ tracklist, artist details, lookup by MBID
- [x] Descriptive `User-Agent` (MusicBrainz blocks generic agents)
- [x] `'musicbrainz'` cache tier (longest TTL of any API tier)
- [x] `'musicbrainz'` added to `AvailableCacheIds`

## Phase 3 — Lidarr service
- [x] `server/api/servarr/lidarr.ts` extending `ServarrBase`
- [x] Override `getQueue` to drop `includeEpisode`
- [x] `getAlbums`, `lookupAlbum`, `addAlbum`, `searchAlbum`, `removeAlbum`, `clearCache`
- [x] `LidarrSettings` in `lib/settings/index.ts` + `settings.lidarr` accessor
- [x] `server/routes/settings/lidarr.ts` (CRUD + `/test`)
- [x] `lidarr-scan` job id + default schedule + registration
- [x] `DownloadTracker` Lidarr queue polling (`getAlbumProgress`)
- [ ] `LidarrModal` settings UI

## Phase 4 — Request lifecycle
- [x] Music branch in `MediaRequest.request()` (`createMusicRequest`)
- [x] `MediaRequestSubscriber.sendToLidarr()`
- [x] `Media.setServiceUrl()` / `getDownloadingItem()` music branches
- [x] Notifications: third arm for the `MOVIE ? 'Movie' : 'Series'` ternary
- [x] `server/lib/scanners/lidarr/index.ts` (album + track availability, orphan cleanup)

## Phase 5 — Artwork (CAA)
- [x] `ImageProxy('musicbrainz', 'https://coverartarchive.org', ...)` conservative rate limits
- [x] Branch in `server/routes/imageproxy.ts`
- [x] `'musicbrainz'` type in `CachedImage`
- [x] `next.config.ts` remotePattern entries (`coverartarchive.org`, `archive.org`)
- [x] Card + detail-page art with placeholder fallback

## Phase 6 — Library scanning
- [x] `plexapi.syncLibraries()` widened past the hard-coded `movie`/`show` filter
- [x] `PLEX_LIBRARY_TYPE_FILTER` + `toSeerrLibraryType` for music sections
- [x] `getLibraryContents` / `getRecentlyAdded` take `mediaType`
- [ ] Plex `musicbrainzRegex` GUID extraction + `artist`/`album` branch in `processItem()`
- [ ] Jellyfin music library scanning

## Phase 7 — Permissions
- [x] `REQUEST_MUSIC`, `AUTO_APPROVE_MUSIC`, `AUTO_REQUEST_MUSIC` (no 4K variants)
- [x] `User.permissions` widened to `bigint` for Postgres (+ transformer + migration)

## Phase 8 — Frontend
- [x] `aspect?: 'poster' | 'square'` prop on `TitleCard` (defaults to `poster`)
- [x] `TitleCard/Placeholder` takes the same prop
- [x] Square summary/title clamps, CAA image branch, `/music/:id` link
- [x] Sidebar "Music" entry (`MusicalNoteIcon`) → `/discover/music`
- [x] `/discover/music` page (search-driven; MusicBrainz has no trending feed)
- [x] `MusicRequestModal` (track selection) + `MusicDetails` (square hero)
- [x] `ArtistDetails` page mirroring `PersonDetails` (bio + album grid)
- [x] Artist/music **badges** on cards to distinguish from persons/actors
- [x] `ListView` music rendering, `MusicSearchResult` model
- [ ] Music section on the discover *landing* page

## Phase 9 — Docs & validation
- [ ] `seerr-api.yml` schemas and endpoints
- [x] `typecheck:server`, `typecheck:client`, `eslint` (0 errors), `node server/test/index.mts` (235 pass)