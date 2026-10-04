import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import { getAppVersion } from '@server/utils/appVersion';
import type {
  MbArtistDetails,
  MbArtistSearchResult,
  MbReleaseDetails,
  MbReleaseSearchResult,
  MbSearchResponse,
} from './interfaces';

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

    const response = await this.getRolling<
      MbSearchResponse<MbReleaseSearchResult>
    >(
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
    );

    return response.results.map((result) =>
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
    const response = await this.getRolling<MbReleaseDetails>(
      `/release/${releaseMbid}`,
      {
        params: {
          inc: 'recordings+artist-credits+release-groups+labels',
          fmt: 'json',
        },
      },
      3600
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

    const response = await this.getRolling<
      MbSearchResponse<MbReleaseSearchResult>
    >(
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
    );

    return response.results.map((result) =>
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

    const response = await this.getRolling<MbArtistDetails>(
      `/artist/${artistMbid}`,
      {
        params: {
          inc: 'tags+aliases+artist-rels',
          fmt: 'json',
        },
      },
      3600
    );

    return this.mapArtistDetails(response);
  }

  /**
   * List an artist's releases for the artist page's album grid.
   */
  public async getArtistReleases({
    artistMbid,
    limit = 50,
    offset = 0,
  }: {
    artistMbid: string;
    limit?: number;
    offset?: number;
  }): Promise<MusicBrainzRelease[]> {
    if (!isValidMbid(artistMbid)) {
      return [];
    }

    const response = await this.getRolling<
      MbSearchResponse<MbReleaseSearchResult>
    >(
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
    );

    return (
      response.results
        .map((result) => this.mapReleaseSearchResult(result))
        // Artist credits are sometimes omitted on release searches even with the artist
        // filter applied; fall back to a label rather than dropping the release.
        .map((release) => ({
          ...release,
          artistName: release.artistName || 'Unknown Artist',
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

    const response = await this.getRolling<
      MbSearchResponse<MbArtistSearchResult>
    >(
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
    );

    return response.results.map((result) => ({
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
      trackCount: release['recording-count'] ?? release.tracks?.length,
      tracks: (release.tracks ?? release.recording ?? []).map((track) => ({
        id: track.recording?.id ?? track.id,
        title: track.title,
        // Prefer the printed track number over array order: multi-disc releases and
        // preorders can make positional order differ from what is on the sleeve.
        trackNumber: track.number
          ? Number(track.number)
          : (track.position ?? 0),
        length: track.recording?.length ?? track.length,
      })),
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
