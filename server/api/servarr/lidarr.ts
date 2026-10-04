import logger from '@server/logger';
import type { AxiosResponse } from 'axios';
import ServarrBase, { type ServarrQueueItem } from './base';

export interface LidarrArtist {
  id: number;
  artistName: string;
  foreignArtistId: string;
  overview?: string;
  path?: string;
  qualityProfileId?: number;
  monitored: boolean;
  albums?: LidarrAlbum[];
  tags?: number[];
  titleSlug?: string;
  statistics?: {
    albumCount: number;
    trackFileCount: number;
    trackCount: number;
    totalTrackCount: number;
    sizeOnDisk: number;
    percentOfTracks: number;
  };
}

export interface LidarrAlbum {
  id: number;
  title: string;
  disambiguation?: string;
  overview?: string;
  artistId: number;
  /** MusicBrainz release-group ID. */
  foreignAlbumId: string;
  monitored: boolean;
  anyReleaseOk?: boolean;
  profileId?: number;
  duration?: number;
  albumType?: string;
  secondaryTypes?: string[];
  mediumCount?: number;
  releaseDate?: string;
  artist?: LidarrArtist;
  images?: { coverType: string; url: string; remoteUrl?: string }[];
  media?: {
    mediumNumber: number;
    format?: string;
    trackCount?: number;
    hasFile?: boolean;
  }[];
  statistics?: {
    trackFileCount: number;
    trackCount: number;
    totalTrackCount: number;
    sizeOnDisk: number;
    percentOfTracks: number;
  };
  titleSlug?: string;
  rootFolderPath?: string;
  addOptions?: {
    addType?: string;
    searchForNewAlbum?: boolean;
    monitor?: string;
  };
}

export interface AddAlbumOptions {
  title: string;
  qualityProfileId: number;
  rootFolderPath: string;
  /** MusicBrainz release-group ID; this is what Lidarr keys albums off. */
  foreignAlbumId: string;
  /** MusicBrainz artist ID, required when Lidarr does not already know the artist. */
  artistId?: number;
  artistForeignId?: string;
  albumType?: string;
  monitored?: boolean;
  anyReleaseOk?: boolean;
  tags?: number[];
  searchNow?: boolean;
}

/**
 * Queue items in Lidarr are keyed by `albumId`, rather than the movie and episode ids
 * the other *arr apps use. The shared queue fields come from the base class.
 */
export interface LidarrQueueItem {
  albumId?: number;
  artistId?: number;
  id: number;
}

/**
 * Lidarr API client.
 *
 * Lidarr speaks API v1 (unlike Radarr and Sonarr's v3) and is organised around
 * artists and albums, so requests resolve a MusicBrainz release onto an album rather
 * than a title and season.
 */
class LidarrAPI extends ServarrBase<LidarrQueueItem> {
  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super({ url, apiKey, cacheName: 'lidarr', apiName: 'Lidarr' });
  }

  /**
   * Lidarr's queue takes no Sonarr-specific `includeEpisode` parameter, so the shared
   * implementation is overridden rather than inherited.
   */
  public getQueue = async (): Promise<ServarrQueueItem<LidarrQueueItem>[]> => {
    try {
      const response = await this.axios.get('/queue');

      return response.data.records;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve queue: ${e.message}`, {
        cause: e,
      });
    }
  };

  public async getAlbums(): Promise<LidarrAlbum[]> {
    try {
      const response = await this.axios.get<LidarrAlbum[]>('/album');

      return response.data;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve albums: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getLibraryAlbumsByForeignId(
    foreignAlbumId: string
  ): Promise<LidarrAlbum[]> {
    try {
      const response = await this.axios.get<LidarrAlbum[]>('/album', {
        params: { foreignAlbumId },
      });

      return response.data;
    } catch (e) {
      throw new Error(
        `[Lidarr] Failed to retrieve albums by MusicBrainz ID: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getAlbumByForeignId(
    foreignAlbumId: string
  ): Promise<LidarrAlbum | undefined> {
    try {
      const albums = await this.getLibraryAlbumsByForeignId(foreignAlbumId);

      return albums[0];
    } catch (e) {
      logger.error('Failed to retrieve album by MusicBrainz ID', {
        label: 'Lidarr API',
        errorMessage: e.message,
        foreignAlbumId,
      });
      throw e;
    }
  }

  /**
   * Look an album up without adding it. Used to resolve a MusicBrainz release onto a
   * concrete Lidarr album before a request is created.
   */
  public async lookupAlbum(term: string): Promise<LidarrAlbum[]> {
    let response: AxiosResponse<LidarrAlbum[]>;

    try {
      response = await this.axios.get<LidarrAlbum[]>('/album/lookup', {
        params: { term },
      });
    } catch (e) {
      logger.error('Error looking up album', {
        label: 'Lidarr API',
        errorMessage: e.message,
        term,
      });
      throw e;
    }

    return response.data;
  }

  public async lookupAlbumByForeignId(
    foreignAlbumId: string
  ): Promise<LidarrAlbum | undefined> {
    const albums = await this.lookupAlbum(`lidarr:${foreignAlbumId}`);

    return albums[0];
  }

  public async addAlbum(options: AddAlbumOptions): Promise<LidarrAlbum> {
    try {
      const existing = await this.getAlbumByForeignId(options.foreignAlbumId);

      // Already present: re-issue a search instead of failing on the duplicate, the
      // same way the Radarr client handles an existing movie.
      if (existing) {
        if (existing.statistics?.trackFileCount) {
          logger.info('Album already has files, skipping search', {
            label: 'Lidarr',
            albumTitle: existing.title,
          });
          return existing;
        }

        if (existing.monitored) {
          logger.info(
            'Triggering search for existing monitored album without file',
            {
              label: 'Lidarr',
              albumId: existing.id,
              albumTitle: existing.title,
            }
          );
          this.searchAlbum(existing.id);

          return existing;
        }

        // Present but unmonitored: flip it on rather than adding a duplicate.
        await this.axios.put(`/album/${existing.id}`, {
          ...existing,
          monitored: true,
        });

        return { ...existing, monitored: true };
      }

      const response = await this.axios.post<LidarrAlbum>(`/album`, {
        title: options.title,
        albumType: options.albumType ?? 'Album',
        qualityProfileId: options.qualityProfileId,
        foreignAlbumId: options.foreignAlbumId,
        artistId: options.artistId,
        artistForeignId: options.artistForeignId,
        rootFolderPath: options.rootFolderPath,
        monitored: options.monitored ?? true,
        anyReleaseOk: options.anyReleaseOk ?? true,
        tags: options.tags,
        addOptions: {
          addType: 'automatic',
          searchForNewAlbum: options.searchNow,
          monitor: 'all',
        },
      });

      if (response.data.id) {
        logger.info('Lidarr accepted request', { label: 'Lidarr' });
        logger.debug('Lidarr add details', {
          label: 'Lidarr',
          album: response.data,
        });
      } else {
        logger.error('Failed to add album to Lidarr', {
          label: 'Lidarr',
          options,
        });
        throw new Error('Failed to add album to Lidarr');
      }

      return response.data;
    } catch (e) {
      logger.error(
        'Failed to add album to Lidarr. This might happen if the album already exists, in which case you can safely ignore this error.',
        {
          label: 'Lidarr',
          errorMessage: e.message,
          options,
          response: e?.response?.data,
        }
      );
      throw new Error('Failed to add album to Lidarr', { cause: e });
    }
  }

  public async searchAlbum(albumId: number): Promise<void> {
    logger.info('Executing album search command', {
      label: 'Lidarr API',
      albumId,
    });

    try {
      await this.runCommand('AlbumSearch', { albumIds: [albumId] });
    } catch (e) {
      logger.error(
        'Something went wrong while executing Lidarr album search.',
        {
          label: 'Lidarr API',
          errorMessage: e.message,
          albumId,
        }
      );
    }
  }

  public removeAlbum = async (foreignAlbumId: string): Promise<void> => {
    const album = await this.getAlbumByForeignId(foreignAlbumId);

    if (!album?.id) {
      logger.info(`[Lidarr] Album not in library, nothing to remove`, {
        foreignAlbumId,
      });
      return;
    }

    try {
      await this.axios.delete(`/album/${album.id}`, {
        params: {
          deleteFiles: true,
          addImportExclusion: false,
        },
      });
      logger.info(`[Lidarr] Removed album ${album.title}`);
    } catch (e) {
      if (e?.response?.status === 404) {
        logger.info(`[Lidarr] Album already removed from Lidarr`, {
          foreignAlbumId,
        });
        return;
      }
      throw e;
    }
  };

  public clearCache = ({
    foreignAlbumId,
    externalId,
  }: {
    foreignAlbumId?: string | null;
    externalId?: number | null;
  }) => {
    if (foreignAlbumId) {
      this.removeCache('/album/lookup', {
        term: `lidarr:${foreignAlbumId}`,
      });
    }
    if (externalId) {
      this.removeCache(`/album/${externalId}`);
    }
  };
}

export default LidarrAPI;
