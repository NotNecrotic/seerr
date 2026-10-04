import MusicBrainz from '@server/api/musicbrainz';
import TheMovieDb from '@server/api/themoviedb';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type { MediaRequestBody } from '@server/interfaces/api/requestInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import notificationManager, { Notification } from '@server/lib/notifications';
import overrideRules from '@server/lib/overrideRules';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import requestLock, {
  mediaKey,
  mediaLock,
  userKey,
} from '@server/utils/requestLock';
import { truncate } from 'lodash';
import {
  AfterInsert,
  AfterLoad,
  AfterUpdate,
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  RelationCount,
  UpdateDateColumn,
} from 'typeorm';
import Media from './Media';
import SeasonRequest from './SeasonRequest';
import Track from './Track';
import TrackRequest from './TrackRequest';
import { User } from './User';

export class RequestPermissionError extends Error {}
export class QuotaRestrictedError extends Error {}
export class DuplicateMediaRequestError extends Error {}
export class NoSeasonsAvailableError extends Error {}
export class BlocklistedMediaError extends Error {}

type MediaRequestOptions = {
  isAutoRequest?: boolean;
};

/**
 * Pick the quota bucket that applies to a media type.
 *
 * Music is counted per track rather than per request, but the limit itself behaves the
 * same as the other two types.
 */
const getUserQuotaType = (mediaType: MediaType, quotas: QuotaResponse) => {
  switch (mediaType) {
    case MediaType.MOVIE:
      return quotas.movie;
    case MediaType.TV:
      return quotas.tv;
    case MediaType.MUSIC:
      return quotas.music;
  }
};

@Entity()
export class MediaRequest {
  public static async request(
    requestBody: MediaRequestBody,
    user: User,
    options: MediaRequestOptions = {}
  ): Promise<MediaRequest> {
    // is4k is optional, and an undefined one binds as null in the duplicate query
    const body = { ...requestBody, is4k: !!requestBody.is4k };

    // Only a caller allowed to set the request user may queue on their lock
    const lockUserId =
      body.userId &&
      user.hasPermission([Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS])
        ? body.userId
        : user.id;

    // No is4k in the key: one media row holds both statuses, so a 4k and a
    // non-4k request for the same title race to create it
    return requestLock.dispatch(userKey(lockUserId), () =>
      mediaLock.dispatch(mediaKey(body.mediaType, body.mediaId), () =>
        MediaRequest.createRequest(body, user, options)
      )
    );
  }

  private static async createRequest(
    requestBody: MediaRequestBody,
    user: User,
    options: MediaRequestOptions
  ): Promise<MediaRequest> {
    const tmdb = new TheMovieDb();
    const mediaRepository = getRepository(Media);
    const requestRepository = getRepository(MediaRequest);
    const userRepository = getRepository(User);
    const settings = getSettings();

    let requestUser = user;

    if (
      requestBody.userId &&
      !requestUser.hasPermission([
        Permission.MANAGE_USERS,
        Permission.MANAGE_REQUESTS,
      ])
    ) {
      throw new RequestPermissionError(
        'You do not have permission to modify the request user.'
      );
    } else if (requestBody.userId) {
      requestUser = await userRepository.findOneOrFail({
        where: { id: requestBody.userId },
      });
    }

    if (!requestUser) {
      throw new Error('User missing from request context.');
    }

    if (
      requestBody.mediaType === MediaType.MOVIE &&
      !requestUser.hasPermission(
        requestBody.is4k
          ? [Permission.REQUEST_4K, Permission.REQUEST_4K_MOVIE]
          : [Permission.REQUEST, Permission.REQUEST_MOVIE],
        {
          type: 'or',
        }
      )
    ) {
      throw new RequestPermissionError(
        `You do not have permission to make ${
          requestBody.is4k ? '4K ' : ''
        }movie requests.`
      );
    } else if (
      requestBody.mediaType === MediaType.TV &&
      !requestUser.hasPermission(
        requestBody.is4k
          ? [Permission.REQUEST_4K, Permission.REQUEST_4K_TV]
          : [Permission.REQUEST, Permission.REQUEST_TV],
        {
          type: 'or',
        }
      )
    ) {
      throw new RequestPermissionError(
        `You do not have permission to make ${
          requestBody.is4k ? '4K ' : ''
        }series requests.`
      );
    } else if (
      requestBody.mediaType === MediaType.MUSIC &&
      !requestUser.hasPermission(
        [Permission.REQUEST, Permission.REQUEST_MUSIC],
        {
          type: 'or',
        }
      )
    ) {
      throw new RequestPermissionError(
        'You do not have permission to make music requests.'
      );
    }

    const quotas = await requestUser.getQuota();

    const canBypassQuota = user.hasPermission(Permission.MANAGE_REQUESTS);
    const quota = getUserQuotaType(requestBody.mediaType, quotas);
    const ignoreQuota =
      requestBody.ignoreQuota === true &&
      canBypassQuota &&
      (quota?.limit ?? 0) > 0;

    if (!ignoreQuota) {
      if (requestBody.ignoreQuota && !canBypassQuota) {
        throw new RequestPermissionError(
          'You do not have permission to bypass user quota limits.'
        );
      } else if (
        requestBody.mediaType === MediaType.MOVIE &&
        quotas.movie.restricted
      ) {
        throw new QuotaRestrictedError('Movie Quota exceeded.');
      } else if (
        requestBody.mediaType === MediaType.TV &&
        quotas.tv.restricted
      ) {
        throw new QuotaRestrictedError('Series Quota exceeded.');
      } else if (
        requestBody.mediaType === MediaType.MUSIC &&
        quotas.music.restricted
      ) {
        throw new QuotaRestrictedError('Music Quota exceeded.');
      }
    }

    if (requestBody.mediaType === MediaType.MUSIC) {
      // Music is keyed on MusicBrainz rather than TMDB, and its request shape (tracks
      // rather than seasons) differs enough that it is handled before the shared
      // TMDB-based preamble rather than threaded through it.
      return MediaRequest.createMusicRequest(
        requestBody,
        requestUser,
        user,
        options,
        canBypassQuota,
        ignoreQuota
      );
    }

    const tmdbMedia =
      requestBody.mediaType === MediaType.MOVIE
        ? await tmdb.getMovie({ movieId: requestBody.mediaId })
        : await tmdb.getTvShow({ tvId: requestBody.mediaId });

    let media = await mediaRepository.findOne({
      where: {
        tmdbId: requestBody.mediaId,
        mediaType: requestBody.mediaType,
      },
      relations: ['requests'],
    });

    if (!media) {
      media = new Media({
        tmdbId: tmdbMedia.id,
        tvdbId: requestBody.tvdbId ?? tmdbMedia.external_ids.tvdb_id,
        status: !requestBody.is4k ? MediaStatus.PENDING : MediaStatus.UNKNOWN,
        status4k: requestBody.is4k ? MediaStatus.PENDING : MediaStatus.UNKNOWN,
        mediaType: requestBody.mediaType,
      });
    } else {
      if (media.status === MediaStatus.BLOCKLISTED) {
        logger.warn('Request for media blocked due to being blocklisted', {
          tmdbId: tmdbMedia.id,
          mediaType: requestBody.mediaType,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This media is blocklisted.');
      }

      if (
        (media.status === MediaStatus.UNKNOWN ||
          media.status === MediaStatus.DELETED) &&
        !requestBody.is4k
      ) {
        media.status = MediaStatus.PENDING;
      }

      if (
        (media.status4k === MediaStatus.UNKNOWN ||
          media.status4k === MediaStatus.DELETED) &&
        requestBody.is4k
      ) {
        media.status4k = MediaStatus.PENDING;
      }
    }

    const existing = await requestRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.media', 'media')
      .leftJoinAndSelect('request.requestedBy', 'user')
      .where('request.is4k = :is4k', { is4k: requestBody.is4k })
      .andWhere('media.tmdbId = :tmdbId', { tmdbId: tmdbMedia.id })
      .andWhere('media.mediaType = :mediaType', {
        mediaType: requestBody.mediaType,
      })
      .getMany();

    if (existing && existing.length > 0) {
      // If there is an existing movie request that isn't declined, don't allow a new one.
      if (
        requestBody.mediaType === MediaType.MOVIE &&
        existing[0].status !== MediaRequestStatus.DECLINED &&
        existing[0].status !== MediaRequestStatus.COMPLETED
      ) {
        logger.warn('Duplicate request for media blocked', {
          tmdbId: tmdbMedia.id,
          mediaType: requestBody.mediaType,
          is4k: requestBody.is4k,
          label: 'Media Request',
        });

        throw new DuplicateMediaRequestError(
          'Request for this media already exists.'
        );
      }

      // If an existing auto-request for this media exists from the same user,
      // don't allow a new one.
      const statusKey = requestBody.is4k ? 'status4k' : 'status';
      if (
        existing.find(
          (r) =>
            r.requestedBy.id === requestUser.id &&
            r.isAutoRequest &&
            r.media?.[statusKey] !== MediaStatus.DELETED
        )
      ) {
        throw new DuplicateMediaRequestError(
          'Auto-request for this media and user already exists.'
        );
      }
    }

    let rootFolder = requestBody.rootFolder;
    let profileId = requestBody.profileId;
    let tags = requestBody.tags;

    const ruleResult = await overrideRules({
      mediaType: requestBody.mediaType,
      is4k: requestBody.is4k || false,
      tmdbMedia,
      requestUser,
      tags,
    });
    const isAdvanced = user.hasPermission(
      [Permission.MANAGE_REQUESTS, Permission.REQUEST_ADVANCED],
      { type: 'or' }
    );
    // Advanced users pick these in the modal, so we don't want to override them if they are set
    const overrideRulesResult = isAdvanced
      ? {
          rootFolder: rootFolder ? null : ruleResult.rootFolder,
          profileId: profileId ? null : ruleResult.profileId,
          tags: tags ? null : ruleResult.tags,
        }
      : ruleResult;
    if (overrideRulesResult.rootFolder) {
      rootFolder = overrideRulesResult.rootFolder;
    }
    if (overrideRulesResult.profileId) {
      profileId = overrideRulesResult.profileId;
    }
    if (overrideRulesResult.tags) {
      tags = overrideRulesResult.tags;
    }
    if (
      overrideRulesResult.rootFolder ||
      overrideRulesResult.profileId ||
      overrideRulesResult.tags
    ) {
      logger.debug('Override rule applied.', {
        label: 'Override Rules',
        overrides: overrideRulesResult,
      });
    }

    if (requestBody.mediaType === MediaType.MOVIE) {
      await mediaRepository.save(media);

      const request = new MediaRequest({
        type: MediaType.MOVIE,
        media,
        requestedBy: requestUser,
        // If the user is an admin or has the "auto approve" permission, automatically approve the request
        status: user.hasPermission(
          [
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K
              : Permission.AUTO_APPROVE,
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K_MOVIE
              : Permission.AUTO_APPROVE_MOVIE,
            Permission.MANAGE_REQUESTS,
          ],
          { type: 'or' }
        )
          ? MediaRequestStatus.APPROVED
          : MediaRequestStatus.PENDING,
        modifiedBy: user.hasPermission(
          [
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K
              : Permission.AUTO_APPROVE,
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K_MOVIE
              : Permission.AUTO_APPROVE_MOVIE,
            Permission.MANAGE_REQUESTS,
          ],
          { type: 'or' }
        )
          ? user
          : undefined,
        is4k: requestBody.is4k,
        serverId: requestBody.serverId,
        profileId: profileId,
        rootFolder: rootFolder,
        tags: tags,
        isAutoRequest: options.isAutoRequest ?? false,
        ignoreQuota,
      });

      await requestRepository.save(request);
      return request;
    } else {
      const tmdbMediaShow = tmdbMedia as Awaited<
        ReturnType<typeof tmdb.getTvShow>
      >;
      let requestedSeasons =
        requestBody.seasons === 'all'
          ? tmdbMediaShow.seasons
              .filter(
                (season) =>
                  season.season_number !== 0 && season.episode_count > 0
              )
              .map((season) => season.season_number)
          : (requestBody.seasons as number[]);
      if (!settings.main.enableSpecialEpisodes) {
        requestedSeasons = requestedSeasons.filter((sn) => sn > 0);
      }

      let existingSeasons: number[] = [];

      // We need to check existing requests on this title to make sure we don't double up on seasons that were
      // already requested. In the case they were, we just throw out any duplicates but still approve the request.
      // (Unless there are no seasons, in which case we abort)
      if (media.requests) {
        existingSeasons = media.requests
          .filter(
            (request) =>
              request.is4k === requestBody.is4k &&
              request.status !== MediaRequestStatus.DECLINED &&
              request.status !== MediaRequestStatus.COMPLETED
          )
          .reduce((seasons, request) => {
            const combinedSeasons = request.seasons.map(
              (season) => season.seasonNumber
            );

            return [...seasons, ...combinedSeasons];
          }, [] as number[]);
      }

      // We should also check seasons that are available/partially available but don't have existing requests
      if (media.seasons) {
        existingSeasons = [
          ...existingSeasons,
          ...media.seasons
            .filter(
              (season) =>
                season[requestBody.is4k ? 'status4k' : 'status'] !==
                  MediaStatus.UNKNOWN &&
                season[requestBody.is4k ? 'status4k' : 'status'] !==
                  MediaStatus.DELETED
            )
            .map((season) => season.seasonNumber),
        ];
      }

      const finalSeasons = requestedSeasons.filter(
        (rs) => !existingSeasons.includes(rs)
      );

      if (finalSeasons.length === 0) {
        throw new NoSeasonsAvailableError('No seasons available to request');
      } else if (
        !ignoreQuota &&
        quotas.tv.limit &&
        finalSeasons.length > (quotas.tv.remaining ?? 0)
      ) {
        throw new QuotaRestrictedError('Series Quota exceeded.');
      }

      await mediaRepository.save(media);

      const request = new MediaRequest({
        type: MediaType.TV,
        media,
        requestedBy: requestUser,
        // If the user is an admin or has the "auto approve" permission, automatically approve the request
        status: user.hasPermission(
          [
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K
              : Permission.AUTO_APPROVE,
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K_TV
              : Permission.AUTO_APPROVE_TV,
            Permission.MANAGE_REQUESTS,
          ],
          { type: 'or' }
        )
          ? MediaRequestStatus.APPROVED
          : MediaRequestStatus.PENDING,
        modifiedBy: user.hasPermission(
          [
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K
              : Permission.AUTO_APPROVE,
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K_TV
              : Permission.AUTO_APPROVE_TV,
            Permission.MANAGE_REQUESTS,
          ],
          { type: 'or' }
        )
          ? user
          : undefined,
        is4k: requestBody.is4k,
        serverId: requestBody.serverId,
        profileId: profileId,
        rootFolder: rootFolder,
        languageProfileId: requestBody.languageProfileId,
        tags: tags,
        seasons: finalSeasons.map(
          (sn) =>
            new SeasonRequest({
              seasonNumber: sn,
              status: user.hasPermission(
                [
                  requestBody.is4k
                    ? Permission.AUTO_APPROVE_4K
                    : Permission.AUTO_APPROVE,
                  requestBody.is4k
                    ? Permission.AUTO_APPROVE_4K_TV
                    : Permission.AUTO_APPROVE_TV,
                  Permission.MANAGE_REQUESTS,
                ],
                { type: 'or' }
              )
                ? MediaRequestStatus.APPROVED
                : MediaRequestStatus.PENDING,
            })
        ),
        isAutoRequest: options.isAutoRequest ?? false,
        ignoreQuota,
      });

      await requestRepository.save(request);
      return request;
    }
  }

  /**
   * Create a music request.
   *
   * A music `Media` row represents a release, and individual tracks within it are
   * requested the same way TV seasons are: a subset of the release's tracks, each with
   * its own approval state.
   */
  private static async createMusicRequest(
    requestBody: MediaRequestBody,
    requestUser: User,
    user: User,
    options: MediaRequestOptions,
    canBypassQuota: boolean,
    ignoreQuota: boolean
  ): Promise<MediaRequest> {
    const mediaRepository = getRepository(Media);
    const requestRepository = getRepository(MediaRequest);
    const musicbrainz = new MusicBrainz();

    if (!requestBody.musicBrainzId) {
      throw new Error('A MusicBrainz ID is required to request music.');
    }

    const release = await musicbrainz.getRelease({
      releaseMbid: requestBody.musicBrainzId,
    });

    if (!release.tracks.length) {
      throw new NoSeasonsAvailableError('This release has no tracks');
    }

    const quotas = await requestUser.getQuota();

    let media = await mediaRepository.findOne({
      where: {
        musicBrainzId: release.id,
        mediaType: MediaType.MUSIC,
      },
      relations: ['requests'],
    });

    if (!media) {
      media = new Media({
        musicBrainzId: release.id,
        // Music has no TMDB id; tmdbId is left null for music rows.
        status: MediaStatus.PENDING,
        mediaType: MediaType.MUSIC,
      });
    } else {
      if (media.status === MediaStatus.BLOCKLISTED) {
        logger.warn('Request for media blocked due to being blocklisted', {
          musicBrainzId: release.id,
          mediaType: MediaType.MUSIC,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This media is blocklisted.');
      }

      if (
        media.status === MediaStatus.UNKNOWN ||
        media.status === MediaStatus.DELETED
      ) {
        media.status = MediaStatus.PENDING;
      }
    }

    // Determine which tracks the user wants. 'all' means the whole release.
    let requestedTracks: number[];

    if (requestBody.tracks === undefined || requestBody.tracks === 'all') {
      requestedTracks = release.tracks.map((track) => track.trackNumber);
    } else {
      requestedTracks = [...new Set(requestBody.tracks)].sort((a, b) => a - b);

      // Guard against clients sending track numbers that do not exist on the release.
      const available = new Set(
        release.tracks.map((track) => track.trackNumber)
      );
      requestedTracks = requestedTracks.filter((track) => available.has(track));
    }

    // Exclude tracks that already have an outstanding request, mirroring how TV
    // seasons are de-duplicated.
    const existingRequests = await requestRepository.find({
      where: { media: { id: media.id } },
      relations: { tracks: true },
    });

    const requestedTrackNumbers = new Set<number>();
    existingRequests.forEach((existing) => {
      if (
        existing.status === MediaRequestStatus.DECLINED ||
        existing.status === MediaRequestStatus.COMPLETED
      ) {
        return;
      }
      existing.tracks?.forEach((track) =>
        requestedTrackNumbers.add(track.trackNumber)
      );
    });

    const finalTracks = requestedTracks.filter(
      (track) => !requestedTrackNumbers.has(track)
    );

    if (finalTracks.length === 0) {
      throw new NoSeasonsAvailableError('No tracks available to request');
    } else if (
      !ignoreQuota &&
      quotas.music.limit &&
      finalTracks.length > (quotas.music.remaining ?? 0)
    ) {
      throw new QuotaRestrictedError('Music Quota exceeded.');
    }

    // Seed the media's track list from the release so availability can be tracked
    // per track as Lidarr reports files.
    const existingTrackNumbers = new Set(
      (media.tracks ?? []).map((track) => track.trackNumber)
    );
    const newTracks = release.tracks
      .filter((track) => !existingTrackNumbers.has(track.trackNumber))
      .map(
        (track) =>
          new Track({
            trackNumber: track.trackNumber,
            musicBrainzId: track.id,
            status: MediaStatus.UNKNOWN,
          })
      );

    if (newTracks.length) {
      media.tracks = [...(media.tracks ?? []), ...newTracks];
    }

    await mediaRepository.save(media);

    const canAutoApprove = user.hasPermission(
      [
        Permission.AUTO_APPROVE,
        Permission.AUTO_APPROVE_MUSIC,
        Permission.MANAGE_REQUESTS,
      ],
      { type: 'or' }
    );

    const request = new MediaRequest({
      type: MediaType.MUSIC,
      media,
      requestedBy: requestUser,
      status: canAutoApprove
        ? MediaRequestStatus.APPROVED
        : MediaRequestStatus.PENDING,
      modifiedBy: canAutoApprove ? user : undefined,
      // Music has no 4K variant.
      is4k: false,
      serverId: requestBody.serverId,
      profileId: requestBody.profileId,
      rootFolder: requestBody.rootFolder,
      tags: requestBody.tags,
      tracks: finalTracks.map(
        (trackNumber) =>
          new TrackRequest({
            trackNumber,
            status: canAutoApprove
              ? MediaRequestStatus.APPROVED
              : MediaRequestStatus.PENDING,
          })
      ),
      isAutoRequest: options.isAutoRequest ?? false,
      ignoreQuota,
    });

    await requestRepository.save(request);
    return request;
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  @Index()
  public status: MediaRequestStatus;

  @ManyToOne(() => Media, (media) => media.requests, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Media;

  @ManyToOne(() => User, (user) => user.requests, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public requestedBy: User;

  @ManyToOne(() => User, {
    nullable: true,
    eager: true,
    onDelete: 'SET NULL',
  })
  @Index()
  public modifiedBy?: User;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  @Column({ type: 'varchar' })
  public type: MediaType;

  @RelationCount((request: MediaRequest) => request.seasons)
  public seasonCount: number;

  @RelationCount((request: MediaRequest) => request.tracks)
  public trackCount: number;

  @OneToMany(() => SeasonRequest, (season) => season.request, {
    eager: true,
    cascade: true,
  })
  public seasons: SeasonRequest[];

  /**
   * Requested tracks for music media. Mirrors `seasons`: each carries its own
   * approval state so a subset of a release can be requested and approved.
   */
  @OneToMany(() => TrackRequest, (track) => track.request, {
    eager: true,
    cascade: true,
  })
  public tracks: TrackRequest[];

  @Column({ default: false })
  public is4k: boolean;

  @Column({ nullable: true })
  public serverId: number;

  @Column({ nullable: true })
  public profileId: number;

  @Column({ nullable: true })
  public rootFolder: string;

  @Column({ nullable: true })
  public languageProfileId: number;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      from: (value: string | null): number[] | null => {
        if (value) {
          if (value === 'none') {
            return [];
          }
          return value.split(',').map((v) => Number(v));
        }
        return null;
      },
      to: (value: number[] | null): string | null => {
        if (value) {
          const finalValue = value.join(',');

          // We want to keep the actual state of an "empty array" so we use
          // the keyword "none" to track this.
          if (!finalValue) {
            return 'none';
          }

          return finalValue;
        }
        return null;
      },
    },
  })
  public tags?: number[];

  @Column({ default: false })
  public isAutoRequest: boolean;

  @Column({ default: false })
  public ignoreQuota: boolean;

  constructor(init?: Partial<MediaRequest>) {
    Object.assign(this, init);
  }

  @AfterInsert()
  public async notifyNewRequest(): Promise<void> {
    if (this.status === MediaRequestStatus.PENDING) {
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: this.media.id },
      });
      if (!media) {
        logger.error('Media data not found', {
          label: 'Media Request',
          requestId: this.id,
          mediaId: this.media.id,
        });
        return;
      }

      MediaRequest.sendNotification(this, media, Notification.MEDIA_PENDING);

      if (this.isAutoRequest) {
        MediaRequest.sendNotification(
          this,
          media,
          Notification.MEDIA_AUTO_REQUESTED
        );
      }
    }
  }

  /**
   * Notification for approval
   *
   * We only check on AfterUpdate as to not trigger this for
   * auto approved content
   */
  @AfterUpdate()
  public async notifyApprovedOrDeclined(autoApproved = false): Promise<void> {
    if (
      this.status === MediaRequestStatus.APPROVED ||
      this.status === MediaRequestStatus.DECLINED
    ) {
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: this.media.id },
      });
      if (!media) {
        logger.error('Media data not found', {
          label: 'Media Request',
          requestId: this.id,
          mediaId: this.media.id,
        });
        return;
      }

      if (
        this.status === MediaRequestStatus.APPROVED &&
        media[this.is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE
      ) {
        logger.info(
          'Media is already available. Sending availability notification instead of approval.',
          { label: 'Media Request', requestId: this.id, mediaId: this.media.id }
        );
        MediaRequest.sendNotification(
          this,
          media,
          Notification.MEDIA_AVAILABLE
        );
        return;
      }

      MediaRequest.sendNotification(
        this,
        media,
        this.status === MediaRequestStatus.APPROVED
          ? autoApproved
            ? Notification.MEDIA_AUTO_APPROVED
            : Notification.MEDIA_APPROVED
          : Notification.MEDIA_DECLINED
      );

      if (
        this.status === MediaRequestStatus.APPROVED &&
        autoApproved &&
        this.isAutoRequest
      ) {
        MediaRequest.sendNotification(
          this,
          media,
          Notification.MEDIA_AUTO_REQUESTED
        );
      }
    }
  }

  @AfterInsert()
  public async autoapprovalNotification(): Promise<void> {
    if (this.status === MediaRequestStatus.APPROVED) {
      this.notifyApprovedOrDeclined(true);
    }
  }

  @AfterLoad()
  private sortSeasons() {
    if (Array.isArray(this.seasons)) {
      this.seasons.sort((a, b) => a.id - b.id);
    }
  }

  static async sendNotification(
    entity: MediaRequest,
    media: Media,
    type: Notification
  ) {
    const tmdb = new TheMovieDb();

    try {
      const mediaType =
        entity.type === MediaType.MOVIE
          ? 'Movie'
          : entity.type === MediaType.MUSIC
            ? 'Album'
            : 'Series';
      let event: string | undefined;
      let notifyAdmin = true;
      let notifySystem = true;

      switch (type) {
        case Notification.MEDIA_AVAILABLE:
          event = `${entity.is4k ? '4K ' : ''}${mediaType} Now Available`;
          notifyAdmin = false;
          break;
        case Notification.MEDIA_APPROVED:
          event = `${entity.is4k ? '4K ' : ''}${mediaType} Request Approved`;
          notifyAdmin = false;
          break;
        case Notification.MEDIA_DECLINED:
          event = `${entity.is4k ? '4K ' : ''}${mediaType} Request Declined`;
          notifyAdmin = false;
          break;
        case Notification.MEDIA_PENDING:
          event = `New ${entity.is4k ? '4K ' : ''}${mediaType} Request`;
          break;
        case Notification.MEDIA_AUTO_REQUESTED:
          event = `${
            entity.is4k ? '4K ' : ''
          }${mediaType} Request Automatically Submitted`;
          notifyAdmin = false;
          notifySystem = false;
          break;
        case Notification.MEDIA_AUTO_APPROVED:
          event = `${
            entity.is4k ? '4K ' : ''
          }${mediaType} Request Automatically Approved`;
          break;
        case Notification.MEDIA_FAILED:
          event = `${entity.is4k ? '4K ' : ''}${mediaType} Request Failed`;
          break;
      }

      if (entity.type === MediaType.MOVIE) {
        const movie = await tmdb.getMovie({ movieId: media.tmdbId });
        notificationManager.sendNotification(type, {
          media,
          request: entity,
          notifyAdmin,
          notifySystem,
          notifyUser: notifyAdmin ? undefined : entity.requestedBy,
          event,
          subject: `${movie.title}${
            movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
          }`,
          message: truncate(movie.overview, {
            length: 500,
            separator: /\s/,
            omission: '…',
          }),
          image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`,
        });
      } else if (entity.type === MediaType.TV) {
        const tv = await tmdb.getTvShow({ tvId: media.tmdbId });
        notificationManager.sendNotification(type, {
          media,
          request: entity,
          notifyAdmin,
          notifySystem,
          notifyUser: notifyAdmin ? undefined : entity.requestedBy,
          event,
          subject: `${tv.name}${
            tv.first_air_date ? ` (${tv.first_air_date.slice(0, 4)})` : ''
          }`,
          message: truncate(tv.overview, {
            length: 500,
            separator: /\s/,
            omission: '…',
          }),
          image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tv.poster_path}`,
          extra: [
            {
              name: 'Requested Seasons',
              value: entity.seasons
                .map((season) => season.seasonNumber)
                .join(', '),
            },
          ],
        });
      } else if (entity.type === MediaType.MUSIC) {
        // Music has no artwork on MusicBrainz, so cover art comes from the Cover Art
        // Archive, which is a separate service and may not have a front cover.
        const musicbrainz = new MusicBrainz();

        if (media.musicBrainzId) {
          const release = await musicbrainz.getRelease({
            releaseMbid: media.musicBrainzId,
          });

          const subject = `${release.title}${
            release.date ? ` (${release.date.slice(0, 4)})` : ''
          }`;

          notificationManager.sendNotification(type, {
            media,
            request: entity,
            notifyAdmin,
            notifySystem,
            notifyUser: notifyAdmin ? undefined : entity.requestedBy,
            event,
            subject,
            message: truncate(release.overview ?? '', {
              length: 500,
              separator: /\s/,
              omission: '…',
            }),
            // Omitted rather than guessed: a missing CAA cover would 404 in the
            // notification image, and some notification agents have no fallback.
            image: release.coverArt,
            extra: [
              {
                name: 'Requested Tracks',
                value: entity.tracks
                  .map((track) => track.trackNumber)
                  .join(', '),
              },
            ],
          });
        }
      }
    } catch (e) {
      logger.error('Something went wrong sending media notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        requestId: entity.id,
        mediaId: entity.media.id,
      });
    }
  }
}

export default MediaRequest;
