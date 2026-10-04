import ExternalAPI from '@server/api/externalapi';
import { ApiErrorCode } from '@server/constants/error';
import type { Library, PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { ApiError } from '@server/types/error';

interface PlexStatusResponse {
  MediaContainer: {
    machineIdentifier: string;
    friendlyName: string;
  };
}

export interface PlexLibraryItem {
  ratingKey: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  title: string;
  guid: string;
  parentGuid?: string;
  grandparentGuid?: string;
  addedAt: number;
  updatedAt: number;
  Guid?: {
    id: string;
  }[];
  type: 'movie' | 'show' | 'season' | 'episode' | 'artist' | 'album' | 'track';
  Media: Media[];
}

interface PlexLibraryResponse {
  MediaContainer: {
    totalSize: number;
    Metadata: PlexLibraryItem[];
  };
}

export interface PlexLibrary {
  // Plex reports music libraries as 'artist'.
  type: 'show' | 'movie' | 'artist' | 'album';
  key: string;
  title: string;
  agent: string;
}

interface PlexLibrariesResponse {
  MediaContainer: {
    Directory: PlexLibrary[];
  };
}

export interface PlexMetadata {
  ratingKey: string;
  parentRatingKey?: string;
  guid: string;
  type: 'movie' | 'show' | 'season';
  title: string;
  Guid: {
    id: string;
  }[];
  Children?: {
    size: 12;
    Metadata: PlexMetadata[];
  };
  index: number;
  parentIndex?: number;
  leafCount: number;
  viewedLeafCount: number;
  addedAt: number;
  updatedAt: number;
  Media: Media[];
}

interface Media {
  id: number;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  aspectRatio: number;
  audioChannels: number;
  audioCodec: string;
  videoCodec: string;
  videoResolution: string;
  container: string;
  videoFrameRate: string;
  videoProfile: string;
}

interface PlexMetadataResponse {
  MediaContainer: {
    Metadata: PlexMetadata[];
  };
}

/**
 * Normalise Plex's section type into Seerr's library type.
 *
 * Plex uses separate 'artist' and 'album' section types; Seerr models both as music
 * because album-level availability is what a music request tracks.
 */
const toSeerrLibraryType = (type: PlexLibrary['type']): Library['type'] =>
  type === 'artist' || type === 'album' ? 'music' : type;

/**
 * Map a Plex library section type onto the metadata filter Seerr uses for it.
 *
 * Plex reports music libraries as 'artist' (album-level view) or 'album', while Seerr
 * models music libraries as 'music'.
 */
const PLEX_LIBRARY_TYPE_FILTER: Record<
  Library['type'],
  { type: string; includeGuids: boolean }
> = {
  show: { type: '4', includeGuids: false },
  movie: { type: '1', includeGuids: true },
  // 8 is Plex's album filter; guids are what music matching reads.
  music: { type: '8', includeGuids: true },
};

class PlexAPI extends ExternalAPI {
  constructor({
    plexToken,
    plexSettings,
    timeout,
  }: {
    plexToken?: string | null;
    plexSettings?: PlexSettings;
    timeout?: number;
  }) {
    const settings = getSettings();
    const settingsPlex = plexSettings ?? settings.plex;

    const protocol = settingsPlex.useSsl ? 'https' : 'http';
    const baseUrl = `${protocol}://${settingsPlex.ip}:${settingsPlex.port}`;

    super(
      baseUrl,
      {},
      {
        timeout,
        headers: {
          'X-Plex-Token': plexToken ?? '',
          'X-Plex-Client-Identifier': settings.clientId,
          'X-Plex-Product': 'Seerr',
          'X-Plex-Device-Name': 'Seerr',
          'X-Plex-Platform': 'Seerr',
        },
      }
    );
  }

  public async getStatus(): Promise<PlexStatusResponse> {
    return await this.get('/');
  }

  public async getLibraries(): Promise<PlexLibrary[]> {
    const response = await this.get<PlexLibrariesResponse>('/library/sections');

    return response.MediaContainer.Directory;
  }

  public async syncLibraries(): Promise<void> {
    const settings = getSettings();

    try {
      const libraries = await this.getLibraries();

      const newLibraries: Library[] = libraries
        // Remove libraries that are not movie, show, or music. Plex reports music
        // libraries as 'artist' or 'album'; both are scanned at the album level.
        .filter(
          (library) =>
            library.type === 'movie' ||
            library.type === 'show' ||
            library.type === 'artist' ||
            library.type === 'album'
        )
        // Remove libraries that do not have a metadata agent set (usually personal video libraries)
        .filter((library) => library.agent !== 'com.plexapp.agents.none')
        .map((library) => {
          const existing = settings.plex.libraries.find(
            (l) => l.id === library.key
          );

          return {
            id: library.key,
            name: library.title,
            enabled: existing?.enabled ?? false,
            type: toSeerrLibraryType(library.type),
            lastScan: existing?.lastScan,
          };
        });

      settings.plex.libraries = newLibraries;
    } catch (e) {
      logger.error('Failed to fetch Plex libraries', {
        label: 'Plex API',
        message: e.message,
      });

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }

    await settings.save();
  }

  public async getLibraryContents(
    id: string,
    {
      offset = 0,
      size = 50,
      mediaType = 'movie',
    }: { offset?: number; size?: number; mediaType?: Library['type'] } = {}
  ): Promise<{ totalSize: number; items: PlexLibraryItem[] }> {
    const filter = PLEX_LIBRARY_TYPE_FILTER[mediaType];
    const response = await this.get<PlexLibraryResponse>(
      `/library/sections/${id}/all?type=${filter.type}${
        filter.includeGuids ? '&includeGuids=1' : ''
      }`,
      {
        headers: {
          'X-Plex-Container-Start': `${offset}`,
          'X-Plex-Container-Size': `${size}`,
        },
      }
    );

    return {
      totalSize: response.MediaContainer.totalSize,
      items: response.MediaContainer.Metadata ?? [],
    };
  }

  public async getMetadata(
    key: string,
    options: { includeChildren?: boolean } = {}
  ): Promise<PlexMetadata> {
    const response = await this.get<PlexMetadataResponse>(
      `/library/metadata/${key}${
        options.includeChildren ? '?includeChildren=1' : ''
      }`
    );

    return response.MediaContainer.Metadata[0];
  }

  public async getChildrenMetadata(key: string): Promise<PlexMetadata[]> {
    const response = await this.get<PlexMetadataResponse>(
      `/library/metadata/${key}/children`
    );

    return response.MediaContainer.Metadata;
  }

  public async getRecentlyAdded(
    id: string,
    options: { addedAt: number } = {
      addedAt: Date.now() - 1000 * 60 * 60,
    },
    mediaType: Library['type'] = 'movie'
  ): Promise<PlexLibraryItem[]> {
    const filter = PLEX_LIBRARY_TYPE_FILTER[mediaType];
    const response = await this.get<PlexLibraryResponse>(
      `/library/sections/${id}/all?type=${filter.type}${
        filter.includeGuids ? '&includeGuids=1' : ''
      }&sort=addedAt%3Adesc&addedAt>>=${Math.floor(options.addedAt / 1000)}`,
      {
        headers: {
          'X-Plex-Container-Start': '0',
          'X-Plex-Container-Size': '500',
        },
      }
    );

    return response.MediaContainer.Metadata;
  }
}

export default PlexAPI;
