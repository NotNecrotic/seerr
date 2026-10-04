# Music Requesting Support — MusicBrainz + Lidarr

Status: **IN PROGRESS** (see `progress.md` for live state)

## Goal

Add full music requesting to Seerr, mirroring the existing movie (TMDB + Radarr)
and TV (TMDB/TVDB + Sonarr) implementations.

Metadata comes from **MusicBrainz**; requests are fulfilled by **Lidarr**; artwork
comes from the **Cover Art Archive (CAA)** through the existing `ImageProxy`.

## Confirmed decisions

| Decision | Choice | Rationale |
|---|---|---|
| Requestable unit | Track (song), with album as parent | Mirrors TV seasons/episodes |
| `Media` row | The **release/album** | Lidarr + Plex both operate at album level |
| Track children | New `Track` / `TrackRequest` entities | Direct mirror of `Season` / `SeasonRequest` |
| MusicBrainz IDs | New nullable `Media.musicBrainzId` varchar | Leaves the int `tmdbId` path untouched |
| Artwork | CAA via existing `ImageProxy` mechanism | Same pattern as movies/TV |
| Card aspect | New `aspect?: 'poster' \| 'square'` prop on `TitleCard` | Square CAA art vs vertical posters |
| Artists | Derived read-only entity, parallel to `Person` | Not requestable, so no `Media` row / quota / permission |
| Library sync | Both Plex and Jellyfin | User requirement |
| Discover | Own `/discover/music` section | User requirement |

## Architecture reference

| Concern | Movies | TV | Music |
|---|---|---|---|
| External ID | `Media.tmdbId` | `Media.tmdbId` | `Media.musicBrainzId` |
| Metadata API | `api/themoviedb` | `api/themoviedb` + `api/tvdb` | `api/musicbrainz` (new) |
| Arr client | `api/servarr/radarr` (v3) | `api/servarr/sonarr` (v3) | `api/servarr/lidarr` (v1, new) |
| Sub-unit | — | `Season` / `SeasonRequest` | `Track` / `TrackRequest` (new) |
| Quota key | `quotas.movie` | `quotas.tv` | `quotas.music` |
| Permissions | `REQUEST_MOVIE` | `REQUEST_TV` | `REQUEST_MUSIC` (new) |
| Library type | `'movie'` | `'show'` | `'music'` (new) |
| Scanner | `radarrScanner` | `sonarrScanner` | `lidarrScanner` (new) |
| Artwork source | `image.tmdb.org` | `image.tmdb.org` | `coverartarchive.org` |

## Key constraints discovered

1. **Lidarr is API v1, not v3.** Endpoints are `/api/v1/album`,
   `/api/v1/album/lookup?term=`, `/api/v1/artist`, `/api/v1/track`.
   `ServarrBase.getQueue` sends `includeEpisode: true`, which is Sonarr-specific and
   meaningless for Lidarr — must be overridden.
2. **No `metadataProfileId` in Lidarr.** Unlike Radarr, the request modal has a single
   quality-profile dropdown, not profile + metadata-profile.
3. **Lidarr albums key on `foreignAlbumId`** (a MusicBrainz *release-group* ID) plus
   `artistMbId`. A track request must resolve track → release → album first.
4. **`Media.tmdbId` is `int` and indexed**, so music needs a separate nullable
   `musicBrainzId` column with a unique constraint scoped by `mediaType`.
5. **Artwork is never persisted in the DB.** `Media` has no poster column;
   `posterPath` is derived live from the provider on each request. Local caching is a
   URL rewrite (`CachedImage`) into `/imageproxy/:type/*path`. Adding CAA therefore
   needs **no schema work**.
6. **Plex music exposes `musicbrainz://<uuid>` GUIDs**, read via the existing
   `metadata.Guid` array in `getMediaIds()` — better than title-matching.
7. **`ImageProxy` follows redirects and caches to disk**, so CAA's redirect to
   `archive.org` is absorbed by the cache. CAA rate-limits anonymous clients more
   aggressively than TMDB, so `rateLimitOptions` must be tuned down.

## Implementation phases

See `checklist.md` for the full phase-by-phase task list.

## Validation

```bash
pnpm typecheck:server
pnpm typecheck:client
pnpm lint
pnpm test
```