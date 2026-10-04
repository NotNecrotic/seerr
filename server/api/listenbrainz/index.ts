import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { getAppVersion } from '@server/utils/appVersion';

/**
 * Maximum number of MBIDs accepted in one popularity lookup. ListenBrainz caps this
 * per request, so larger result sets are chunked across calls.
 */
const MAX_ITEMS_PER_GET = 100;

/** Raw popularity payload as returned by ListenBrainz. */
interface ListenBrainzReleasePopularityResponse {
  release_mbid: string;
  total_listen_count: number | null;
  total_user_count: number | null;
}

export interface ListenBrainzReleasePopularity {
  releaseMbid: string;
  totalListenCount: number | null;
  totalUserCount: number | null;
}

/**
 * ListenBrainz popularity client.
 *
 * ListenBrainz gates all of its popularity endpoints behind a user token, so this is
 * only usable once an admin has configured one. Callers should check
 * `isEnabled()` first and degrade gracefully when it returns false.
 *
 * Both MusicBrainz and ListenBrainz rate limit anonymous clients to roughly one
 * request per second, so requests are throttled and responses cached.
 */
class ListenBrainzAPI extends ExternalAPI {
  constructor() {
    const timeout = getSettings().network.apiRequestTimeout;
    const settings = getSettings();
    const token = settings.main.listenbrainzToken;
    const contact = settings.main.applicationUrl || 'https://docs.seerr.dev';

    super(
      'https://api.listenbrainz.org',
      {},
      {
        nodeCache: cacheManager.getCache('listenbrainz').data,
        timeout,
        // MetaBrainz allows one call per second for anonymous clients. Token holders
        // may be granted more, but staying at one keeps us well inside the limit.
        rateLimit: {
          maxRequests: 1,
          maxRPS: 1,
        },
        headers: {
          // MetaBrainz blocks requests without a versioned, contactable agent.
          'User-Agent': `Seerr/${getAppVersion()} (${contact})`,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      }
    );
  }

  /** Whether a token is configured, i.e. whether popularity data is available. */
  public isEnabled(): boolean {
    return !!getSettings().main.listenbrainzToken;
  }

  /**
   * Fetch listen and listener counts for a batch of releases.
   *
   * Returns a map keyed by release MBID. Releases ListenBrainz has no data for are
   * omitted rather than mapped to zero, so callers can tell "unranked" from "unlistened".
   */
  public async getReleasePopularity(
    releaseMbids: string[]
  ): Promise<Map<string, ListenBrainzReleasePopularity>> {
    const results = new Map<string, ListenBrainzReleasePopularity>();

    if (!this.isEnabled() || releaseMbids.length === 0) {
      return results;
    }

    // De-duplicate before chunking; the same release can appear more than once when
    // browsing multiple editions of an album.
    const uniqueMbids = [...new Set(releaseMbids)];

    for (
      let index = 0;
      index < uniqueMbids.length;
      index += MAX_ITEMS_PER_GET
    ) {
      const chunk = uniqueMbids.slice(index, index + MAX_ITEMS_PER_GET);

      try {
        const response = await this.axios.post<
          ListenBrainzReleasePopularityResponse[]
        >('/1/popularity/release', { release_mbids: chunk });

        response.data.forEach((entry) => {
          if (!entry?.release_mbid) {
            return;
          }

          results.set(entry.release_mbid, {
            releaseMbid: entry.release_mbid,
            totalListenCount: entry.total_listen_count ?? null,
            totalUserCount: entry.total_user_count ?? null,
          });
        });
      } catch (e) {
        // A failed popularity lookup should degrade the sort, not break the page.
        logger.error('Failed to fetch ListenBrainz release popularity', {
          label: 'ListenBrainz API',
          errorMessage: e.message,
          chunkSize: chunk.length,
        });

        return results;
      }
    }

    return results;
  }
}

export default ListenBrainzAPI;
export { ListenBrainzAPI };
