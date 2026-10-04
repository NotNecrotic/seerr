import type { LidarrAlbum } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Track from '@server/entity/Track';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { uniqWith } from 'lodash';

type SyncStatus = StatusBase & {
  currentServer: LidarrSettings;
  servers: LidarrSettings[];
};

/**
 * Scans Lidarr libraries and syncs album (and track) availability onto `Media` rows.
 *
 * Mirrors the Radarr scanner, minus the 4K handling that music does not have.
 */
class LidarrScanner
  extends BaseScanner<LidarrAlbum>
  implements RunnableScanner<SyncStatus>
{
  private servers: LidarrSettings[];
  private currentServer: LidarrSettings;
  private lidarrApi: LidarrAPI;
  private scannedReleaseGroupIds: Set<string> = new Set();
  private didScan = false;
  private serverReturnedEmpty = false;

  constructor() {
    super('Lidarr Scan', { bundleSize: 50 });
  }

  public status(): SyncStatus {
    return {
      running: this.running,
      progress: this.progress,
      total: this.items.length,
      currentServer: this.currentServer,
      servers: this.servers,
    };
  }

  public async run(): Promise<void> {
    const settings = getSettings();
    const sessionId = this.startRun();
    this.scannedReleaseGroupIds.clear();
    this.didScan = false;
    this.serverReturnedEmpty = false;

    try {
      this.servers = uniqWith(settings.lidarr, (lidarrA, lidarrB) => {
        return (
          lidarrA.hostname === lidarrB.hostname &&
          lidarrA.port === lidarrB.port &&
          lidarrA.baseUrl === lidarrB.baseUrl
        );
      });

      for (const server of this.servers) {
        this.currentServer = server;
        if (server.syncEnabled) {
          this.log(
            `Beginning to process Lidarr server: ${server.name}`,
            'info'
          );

          this.lidarrApi = new LidarrAPI({
            apiKey: server.apiKey,
            url: LidarrAPI.buildUrl(server, '/api/v1'),
          });

          this.items = await this.lidarrApi.getAlbums();

          this.didScan = true;

          if (this.items.length === 0) {
            this.serverReturnedEmpty = true;
            this.log(
              `Lidarr server ${server.name} returned no albums. Orphan cleanup will be skipped.`,
              'warn'
            );
          }

          await this.loop(this.processLidarrAlbum.bind(this), { sessionId });
        } else {
          this.log(`Sync not enabled. Skipping Lidarr server: ${server.name}`);
        }
      }

      await this.cleanupOrphanedAlbums();

      this.log('Scan Complete', 'info');
    } catch (e) {
      this.log('Scan interrupted', 'error', {
        errorMessage: e.message,
      });
    } finally {
      this.endRun(sessionId);
    }
  }

  private async processLidarrAlbum(lidarrAlbum: LidarrAlbum): Promise<void> {
    // Lidarr keys albums on the release-group id, which is what Media stores for
    // music, so that is what orphan detection compares against.
    this.scannedReleaseGroupIds.add(lidarrAlbum.foreignAlbumId);

    const trackFileCount = lidarrAlbum.statistics?.trackFileCount ?? 0;
    const totalTrackCount =
      lidarrAlbum.statistics?.totalTrackCount ?? trackFileCount;
    const hasFile = trackFileCount > 0;
    const isFullyAvailable =
      hasFile && totalTrackCount > 0 && trackFileCount >= totalTrackCount;

    try {
      const mediaRepository = getRepository(Media);

      const media = await mediaRepository.findOne({
        where: {
          musicBrainzId: lidarrAlbum.foreignAlbumId,
          mediaType: MediaType.MUSIC,
        },
        relations: ['requests'],
      });

      if (!media) {
        // Seerr does not import unrequested media, so there is nothing to update.
        this.log(
          `Album ${lidarrAlbum.title} is not tracked by Seerr, skipping`,
          'debug'
        );
        return;
      }

      media.status = hasFile ? MediaStatus.AVAILABLE : MediaStatus.PENDING;
      media.externalServiceId = lidarrAlbum.id;
      media.externalServiceSlug = lidarrAlbum.titleSlug;
      media.serviceId = this.currentServer.id;

      // Lidarr reports file counts per album rather than per track, so a partially
      // downloaded album leaves its tracks partially available.
      if (media.tracks?.length) {
        const trackRepository = getRepository(Track);

        media.tracks.forEach((track) => {
          track.status = hasFile
            ? isFullyAvailable
              ? MediaStatus.AVAILABLE
              : MediaStatus.PARTIALLY_AVAILABLE
            : MediaStatus.PENDING;
        });

        await trackRepository.save(media.tracks);
      }

      // Complete any outstanding requests once the album is fully available.
      if (isFullyAvailable) {
        const requestRepository = getRepository(MediaRequest);
        const requests = await requestRepository.find({
          where: { media: { id: media.id } },
          relations: { tracks: true },
        });

        for (const request of requests) {
          if (
            request.status === MediaRequestStatus.PENDING ||
            request.status === MediaRequestStatus.APPROVED
          ) {
            request.status = MediaRequestStatus.COMPLETED;
            request.tracks?.forEach((track) => {
              track.status = MediaRequestStatus.COMPLETED;
            });
            await requestRepository.save(request);
          }
        }
      }

      await mediaRepository.save(media);

      this.log(`Processed album ${lidarrAlbum.title}`, 'debug', {
        albumTitle: lidarrAlbum.title,
        hasFile,
      });
    } catch (e) {
      this.log('Failed to process Lidarr album', 'error', {
        errorMessage: e.message,
        albumTitle: lidarrAlbum.title,
      });
    }
  }

  /**
   * Reset media stuck in PROCESSING that no longer exists in any Lidarr server.
   *
   * Skipped when a server came back empty, since that usually means a misconfigured
   * connection rather than a genuinely empty library.
   */
  private async cleanupOrphanedAlbums(): Promise<void> {
    if (!this.didScan) {
      this.log(
        'Skipping orphaned album cleanup: no Lidarr servers were scanned.',
        'info'
      );
      return;
    }

    if (this.serverReturnedEmpty) {
      this.log(
        'Skipping orphaned album cleanup: a Lidarr server returned no albums.',
        'info'
      );
      return;
    }

    const mediaRepository = getRepository(Media);
    const processingAlbums = await mediaRepository.find({
      where: { mediaType: MediaType.MUSIC, status: MediaStatus.PROCESSING },
      relations: { requests: true },
    });

    for (const media of processingAlbums) {
      if (
        media.musicBrainzId &&
        !this.scannedReleaseGroupIds.has(media.musicBrainzId)
      ) {
        media.status = MediaStatus.UNKNOWN;
        await mediaRepository.save(media);
        await this.declineOrphanedRequests(media, false);
        this.log(
          `Album ${media.musicBrainzId} not found in any Lidarr server. Status reset to UNKNOWN.`,
          'info'
        );
      }
    }
  }
}

export const lidarrScanner = new LidarrScanner();
