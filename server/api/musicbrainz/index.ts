import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { getAppVersion } from '@server/utils/appVersion';
import type {
  MbArtistDetails,
  MbArtistSearchResult,
  MbReleaseDetails,
  MbReleaseMedia,
  MbReleaseSearchResult,
  MbSearchResponse,
} from './interfaces';
import { mbResults } from './interfaces';

/**
 * Cover Art Archive, which serves album and artist art for MusicBrainz.
 *
 * MusicBrainz itself hosts no artwork, so every image URL is built here rather than
 * read off an API response.
 */
const COVER_ART_ARCHIVE_BASE_URL = 'https://coverartarchive.org';

/**
 * Build the User-Agent sent to MetaBrainz services.
 *
 * MetaBrainz requires `ApplicationName/version (contact-url-or-email)` and warns that
 * requests without a valid agent may be blocked without notice. Several third-party
 * clients were IP-blocked in 2026 over this, so the version is included and the
 * application URL is preferred when configured.
 */
const buildUserAgent = (): string => {
  const settings = getSettings();
  const contact = settings.main.applicationUrl || 'https://docs.seerr.dev';
  const version = getAppVersion();

  return `Seerr/${version} (${contact})`;
};

/**
 * Escape a value for use inside a MusicBrainz Lucene query.
 *
 * Filter values come straight from user-supplied query parameters, so unescaped input
 * would otherwise be able to alter the structure of the query.
 */
const escapeLuceneValue = (value: string): string =>
  value.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');

export interface MusicBrainzTrack {
  id: string;
  title: string;
  /** 1-indexed position within the release. */
  trackNumber: number;
  length?: number;
}

export interface MusicBrainzRelease {
  id: string;
  title: string;
  artistName: string;
  artistId: string;
  /** MusicBrainz release-group ID, which is what Lidarr keys albums off. */
  releaseGroupId: string;
  date?: string;
  country?: string;
  status?: string;
  disambiguation?: string;
  /**
   * MusicBrainz community rating, 0-100.
   *
   * This is far sparser and less well calibrated than TMDB votes, so the rating sort
   * produces lopsided results. ListenBrainz `user_count` is the better signal where
   * a token is configured.
   */
  rating?: number;
  /**
   * MusicBrainz has no editorial summary for releases, unlike TMDB's `overview`, so
   * this is only ever populated from a source such as Lidarr or a local tag.
   */
  overview?: string;
  trackCount?: number;
  tracks: MusicBrainzTrack[];
  /**
   * Front cover URL from the Cover Art Archive, or undefined when no cover exists.
   * Undefined is a normal outcome rather than an error, so callers must handle it.
   */
  coverArt?: string;
}

export interface MusicBrainzArtist {
  id: string;
  name: string;
  sortName?: string;
  type?: string;
  country?: string;
  disambiguation?: string;
  begin?: string;
  end?: string;
  firstReleaseDate?: string;
  genres: string[];
  aliases: string[];
  coverArt?: string;
}

/**
 * Ceiling on how long a single retry will wait, regardless of `Retry-After`.
 */
const MAX_RETRY_DELAY_MS = 10_000;

/**
 * Whether an error is MusicBrainz rate limiting rather than a genuine failure.
 *
 * The service signals throttling with a 503 plus a JSON `error` field, which is the
 * same status used for transient unavailability, so the body is checked too. This
 * matters because the previous behaviour treated every 503 as fatal and reported
 * "Unable to retrieve music releases" for what is really a temporary throttle.
 */
const isRateLimited = (error: unknown): boolean => {
  const response = (error as { response?: { status?: number; data?: unknown } })
    ?.response;

  if (response?.status !== 503) {
    return false;
  }

  const data = response.data as { error?: string } | undefined;

  // No body means we cannot distinguish throttling from an outage; treat it as a
  // throttle anyway, since retrying is harmless and bounded.
  return typeof data?.error === 'string'
    ? /rate limit|too many requests/i.test(data.error)
    : true;
};

/** Read `Retry-After` (seconds) from a throttled response, when present. */
const getRetryAfterMs = (error: unknown): number | undefined => {
  const headers = (
    error as { response?: { headers?: Record<string, unknown> } }
  )?.response?.headers;
  const value = headers?.['retry-after'] ?? headers?.['Retry-After'];

  if (value === undefined) {
    return undefined;
  }

  const seconds = Number(value);

  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
};

/**
 * Produce a message worth logging.
 *
 * A raw axios error for a 503 carries an empty `message` with the useful detail in
 * `response`, which is why rate-limit failures were logged as `errorMessage: ""`.
 */
export const describeApiError = (error: unknown): string => {
  const err = error as {
    message?: string;
    code?: string;
    response?: { status?: number; statusText?: string; data?: unknown };
  };
  const parts: string[] = [];

  if (err?.message) {
    parts.push(err.message);
  }

  if (err?.response) {
    const { status, statusText, data } = err.response;
    parts.push(`HTTP ${status ?? '?'}${statusText ? ` ${statusText}` : ''}`);

    const detail =
      typeof data === 'string'
        ? data
        : ((data as { error?: string; message?: string })?.error ??
          (data as { message?: string })?.message);

    if (detail) {
      parts.push(detail);
    }
  } else if (err?.code) {
    parts.push(err.code);
  }

  return parts.join(' — ') || 'Unknown MusicBrainz error';
};

/**
 * MusicBrainz Web Service (v2) client.
 *
 * Two constraints drive the implementation here:
 *
 * 1. MusicBrainz requires a descriptive User-Agent and throttles anonymous clients to
 *    roughly one request per second, so responses are cached aggressively.
 * 2. Records come back sparse depending on the `inc` query parameters, so most fields
 *    are optional and callers must handle their absence.
 */
class MusicBrainzAPI extends ExternalAPI {
  constructor() {
    const timeout = getSettings().network.apiRequestTimeout;

    super(
      'https://musicbrainz.org/ws/2',
      {},
      {
        nodeCache: cacheManager.getCache('musicbrainz').data,
        timeout,
        // MusicBrainz allows roughly one request per second per source IP and answers
        // anything faster with a 503. Without client-side throttling a burst of page
        // loads reliably trips the limit, so requests are queued to stay under it.
        rateLimit: {
          maxRPS: 1,
          maxRequests: 5,
        },
        headers: {
          // MetaBrainz blocks generic agents; identify the app with a
          // contactable, versioned string.
          'User-Agent': buildUserAgent(),
          Accept: 'application/json',
        },
      }
    );
  }

  /**
   * Perform a request, transparently retrying MusicBrainz rate limiting.
   *
   * A throttled response is a 503 carrying a `Retry-After` header, not a failure of
   * the query, so it is worth waiting out: without this, any burst that trips the
   * limit surfaces as "Unable to retrieve music releases" even though the same query
   * succeeds once the burst subsides. Retries are bounded so a sustained block still
   * fails rather than hanging the request.
   */
  private async withRateLimitRetry<T>(request: () => Promise<T>): Promise<T> {
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await request();
      } catch (e) {
        lastError = e;

        if (!isRateLimited(e) || attempt === MAX_ATTEMPTS) {
          throw e;
        }

        // Honour the server's Retry-After when present, capped so a malicious or
        // mistaken large value cannot stall a page load indefinitely.
        const retryAfterMs = Math.min(
          getRetryAfterMs(e) ?? 1000,
          MAX_RETRY_DELAY_MS
        );

        logger.debug('MusicBrainz rate limit hit, retrying', {
          label: 'API',
          attempt,
          retryAfterMs,
        });

        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      }
    }

    throw lastError;
  }

  /**
   * Verify the service is reachable and usable.
   *
   * MusicBrainz is a keyless public service with no credentials to configure, so this
   * backs the read-only provider row in Settings → Metadata. A single known release is
   * enough to prove both connectivity and that responses parse.
   */
  public async test(): Promise<boolean> {
    const response = await this.withRateLimitRetry(() =>
      this.getRolling<MbSearchResponse<'releases', MbReleaseSearchResult>>(
        '/release',
        {
          params: {
            // Any stable, real release works; this one is used because it is
            // unambiguously an album with a known artist.
            query:
              'release:"Grace" AND arid:187b6e7d-6186-41d3-aaba-76474713965e',
            limit: 1,
            fmt: 'json',
          },
        },
        60
      )
    );

    return mbResults(response, 'releases').length > 0;
  }

  /**
   * Search releases (albums) by a free-text query.
   */
  public async searchReleases({
    query,
    limit = 20,
    offset = 0,
  }: {
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<MusicBrainzRelease[]> {
    const trimmed = query.trim();

    if (!trimmed) {
      return [];
    }

    const response = await this.withRateLimitRetry(() =>
      this.getRolling<MbSearchResponse<'releases', MbReleaseSearchResult>>(
        '/release',
        {
          params: {
            query: trimmed,
            limit,
            offset,
            fmt: 'json',
          },
        },
        3600
      )
    );

    return mbResults(response, 'releases').map((result) =>
      this.mapReleaseSearchResult(result)
    );
  }

  /**
   * Fetch a single release with its full track listing.
   *
   * `recordings` supplies the media/track-list block; `artist-credits` supplies the
   * joined artist name used in the UI.
   */
  public async getRelease({
    releaseMbid,
  }: {
    releaseMbid: string;
    language?: string;
  }): Promise<MusicBrainzRelease> {
    const response = await this.withRateLimitRetry(() =>
      this.getRolling<MbReleaseDetails>(
        `/release/${releaseMbid}`,
        {
          params: {
            inc: 'recordings+artist-credits+release-groups+labels',
            fmt: 'json',
          },
        },
        3600
      )
    );

    return this.mapReleaseDetails(response);
  }

  /**
   * Look a release up by ID, returning undefined when the ID is malformed.
   *
   * MusicBrainz answers a malformed ID with a 400 rather than a 404, so the shape is
   * validated up front to keep bad user input from surfacing as a server error.
   */
  public async getReleaseByMbid({
    releaseMbid,
  }: {
    releaseMbid: string;
    language?: string;
  }): Promise<MusicBrainzRelease | undefined> {
    if (!isValidMbid(releaseMbid)) {
      return undefined;
    }

    return this.getRelease({ releaseMbid });
  }

  /**
   * Browse releases matching the supplied filters.
   *
   * MusicBrainz search accepts Lucene syntax, which lets the date, country, label, and
   * release-type filters be pushed upstream rather than filtered client-side, so the
   * candidate pool stays relevant. Note there is no server-side sort: callers must
   * sort the returned pool themselves.
   */
  public async browseReleases({
    genre,
    country,
    label,
    releaseType,
    releaseDateGte,
    releaseDateLte,
    limit = 100,
    offset = 0,
  }: {
    genre?: string;
    country?: string;
    label?: string;
    releaseType?: string;
    releaseDateGte?: string;
    releaseDateLte?: string;
    limit?: number;
    offset?: number;
  }): Promise<MusicBrainzRelease[]> {
    const clauses: string[] = [];

    if (genre) {
      clauses.push(`tag:"${escapeLuceneValue(genre)}"`);
    }
    if (country) {
      clauses.push(`country:${escapeLuceneValue(country)}`);
    }
    if (label) {
      clauses.push(`label:"${escapeLuceneValue(label)}"`);
    }
    if (releaseType) {
      clauses.push(`primarytype:${escapeLuceneValue(releaseType)}`);
    }

    if (releaseDateGte || releaseDateLte) {
      // Only full ISO dates can be used as range bounds; a year alone is matched as a
      // range instead, since MusicBrainz rejects partial dates in this position.
      const isFullDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
      const lower = releaseDateGte
        ? isFullDate(releaseDateGte)
          ? releaseDateGte
          : `${releaseDateGte}-01`
        : '*';
      const upper = releaseDateLte
        ? isFullDate(releaseDateLte)
          ? releaseDateLte
          : `${releaseDateLte}-12-31`
        : '*';
      clauses.push(`date:[${lower} TO ${upper}]`);
    }

    // Albums only, since Seerr requests releases rather than individual recordings.
    if (!clauses.some((clause) => clause.startsWith('primarytype:'))) {
      clauses.push('primarytype:album');
    }

    const response = await this.withRateLimitRetry(() =>
      this.getRolling<MbSearchResponse<'releases', MbReleaseSearchResult>>(
        '/release',
        {
          params: {
            query: clauses.join(' AND '),
            limit,
            offset,
            fmt: 'json',
          },
        },
        3600
      )
    );

    return mbResults(response, 'releases').map((result) =>
      this.mapReleaseSearchResult(result)
    );
  }

  /**
   * Fetch an artist's details plus their metadata.
   */
  public async getArtist({
    artistMbid,
  }: {
    artistMbid: string;
    language?: string;
  }): Promise<MusicBrainzArtist | undefined> {
    if (!isValidMbid(artistMbid)) {
      return undefined;
    }

    const response = await this.withRateLimitRetry(() =>
      this.getRolling<MbArtistDetails>(
        `/artist/${artistMbid}`,
        {
          params: {
            inc: 'tags+aliases+artist-rels',
            fmt: 'json',
          },
        },
        3600
      )
    );

    return this.mapArtistDetails(response);
  }

  /**
   * List an artist's releases for the artist page's album grid.
   *
   * `artistName` is accepted because the `artist=` browse parameter does not return
   * artist credits, so the name is not otherwise available at this call site.
   */
  public async getArtistReleases({
    artistMbid,
    artistName,
    limit = 50,
    offset = 0,
  }: {
    artistMbid: string;
    artistName?: string;
    limit?: number;
    offset?: number;
  }): Promise<MusicBrainzRelease[]> {
    if (!isValidMbid(artistMbid)) {
      return [];
    }

    const response = await this.withRateLimitRetry(() =>
      this.getRolling<MbSearchResponse<'releases', MbReleaseSearchResult>>(
        '/release',
        {
          params: {
            artist: artistMbid,
            limit,
            offset,
            // Prefer official, non-live releases: Lidarr cannot grab live recordings.
            status: 'official',
            fmt: 'json',
          },
        },
        3600
      )
    );

    return (
      mbResults(response, 'releases')
        .map((result) => this.mapReleaseSearchResult(result))
        // The `artist=` browse parameter does not return artist credits, so fall back
        // to the artist the caller asked for rather than dropping the release.
        .map((release) => ({
          ...release,
          artistName: release.artistName || artistName || '',
          artistId: release.artistId || artistMbid,
        }))
    );
  }

  /**
   * Search artists. Used by the search page and artist search.
   */
  public async searchArtists({
    query,
    limit = 20,
    offset = 0,
  }: {
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<MusicBrainzArtist[]> {
    const trimmed = query.trim();

    if (!trimmed) {
      return [];
    }

    const response = await this.withRateLimitRetry(() =>
      this.getRolling<MbSearchResponse<'artists', MbArtistSearchResult>>(
        '/artist',
        {
          params: {
            query: trimmed,
            limit,
            offset,
            fmt: 'json',
          },
        },
        3600
      )
    );

    return mbResults(response, 'artists').map((result) => ({
      id: result.id,
      name: result.name,
      sortName: result['sort-name'],
      type: result.type,
      country: result.country,
      disambiguation: result.disambiguation,
      begin: result['life-span']?.['begin'],
      end: result['life-span']?.end,
      firstReleaseDate: result['first-release-date'],
      genres: result.tags ?? [],
      aliases: [],
      coverArt: buildCoverArtUrl(result.id, 'front-500'),
    }));
  }

  private mapReleaseSearchResult(
    result: MbReleaseSearchResult
  ): MusicBrainzRelease {
    return {
      id: result.id,
      title: result.title,
      artistName: extractArtistName(result),
      artistId: result.artist?.id ?? '',
      releaseGroupId: result['release-group']?.id ?? '',
      date: result.date,
      country: result.country,
      status: result.status,
      rating: result.rating ?? undefined,
      trackCount:
        result['track-count'] ??
        result.media?.[0]?.['track-count'] ??
        undefined,
      // Release searches omit the track listing; only a full release fetch has it.
      tracks: [],
      coverArt: buildCoverArtUrl(result.id, 'front-500'),
    };
  }

  private mapReleaseDetails(release: MbReleaseDetails): MusicBrainzRelease {
    return {
      id: release.id,
      title: release.title,
      artistName: extractArtistName(release),
      artistId: release.artist?.id ?? '',
      releaseGroupId: release['release-group']?.id ?? '',
      date: release.date,
      country: release.country,
      status: release.status,
      rating: release.rating ?? undefined,
      disambiguation: release.disambiguation,
      trackCount: release['recording-count'],
      tracks: flattenReleaseTracks(release.media),
      coverArt: buildCoverArtUrl(release.id, 'front-500'),
    };
  }

  private mapArtistDetails(artist: MbArtistDetails): MusicBrainzArtist {
    return {
      id: artist.id,
      name: artist.name,
      sortName: artist['sort-name'],
      type: artist.type,
      country: artist.country,
      disambiguation: artist.disambiguation,
      begin: artist['life-span']?.['begin'],
      end: artist['life-span']?.end,
      firstReleaseDate: artist['first-release-date'],
      genres: (artist.tags ?? []).map((tag) => tag.name).filter(Boolean),
      aliases: (artist.aliases ?? []).map((alias) => alias.name),
      coverArt: buildCoverArtUrl(artist.id, 'front-500'),
    };
  }
}

/**
 * Build a Cover Art Archive front-cover URL.
 *
 * The archive redirects to archive.org and returns 404 when a release has no cover,
 * so callers should treat a failed load as "no artwork" rather than an error.
 */
export const buildCoverArtUrl = (
  mbid: string,
  size: 'front-1200' | 'front-500' | 'front-250' = 'front-500'
): string => {
  if (!isValidMbid(mbid)) {
    return '';
  }

  return `${COVER_ART_ARCHIVE_BASE_URL}/release/${mbid}/${size}`;
};

/**
 * Flatten a release's per-disc track lists into one release-wide listing.
 *
 * MusicBrainz nests tracks under `media[]` (one entry per disc) rather than exposing
 * them on the release, and gives each medium a `track-offset` so track numbers stay
 * unique across a multi-disc set.
 */
const flattenReleaseTracks = (media?: MbReleaseMedia[]): MusicBrainzTrack[] => {
  if (!media?.length) {
    return [];
  }

  return media.flatMap((medium) =>
    (medium.tracks ?? []).map((track) => ({
      id: track.recording?.id ?? track.id,
      title: track.title,
      // Prefer the printed track number over array order: multi-disc releases and
      // preorders can make positional order differ from what is on the sleeve.
      trackNumber:
        (medium['track-offset'] ?? 0) +
        (track.number ? Number(track.number) : (track.position ?? 0)),
      length: track.recording?.length ?? track.length,
    }))
  );
};

/**
 * MusicBrainz IDs are UUIDs. Validating up front keeps malformed user input from
 * producing a 400 instead of a clean "not found".
 */
export const isValidMbid = (mbid: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbid);

/**
 * `artist-credit` is an array of credited names with optional join phrases, and in
 * search responses it can degrade to plain strings.
 */
const extractArtistName = (record: {
  artist?: { name?: string };
  'artist-credit'?: (string | { name?: string })[];
}): string => {
  if (record.artist?.name) {
    return record.artist.name;
  }

  const credit = record['artist-credit'];

  if (!credit?.length) {
    return '';
  }

  return credit
    .map((entry) => (typeof entry === 'string' ? entry : (entry.name ?? '')))
    .filter(Boolean)
    .join('');
};

export default MusicBrainzAPI;
export { MusicBrainzAPI };
