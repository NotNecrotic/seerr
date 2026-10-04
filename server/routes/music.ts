import MusicBrainz from '@server/api/musicbrainz';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import logger from '@server/logger';
import { mapRelease } from '@server/models/Music';
import { Router } from 'express';

const musicRoutes = Router();

/**
 * Fetch a release and attach the Seerr-side request/availability state.
 *
 * Music media rows are keyed on `musicBrainzId` rather than `tmdbId`, so this looks the
 * row up directly instead of going through `Media.getRelatedMedia`.
 */
async function getReleaseWithMedia(releaseMbid: string): Promise<{
  release: ReturnType<typeof mapRelease>;
  media?: Media;
}> {
  const musicbrainz = new MusicBrainz();
  const release = await musicbrainz.getRelease({ releaseMbid });

  const mediaRepository = getRepository(Media);
  const media = await mediaRepository.findOne({
    where: { musicBrainzId: release.id, mediaType: MediaType.MUSIC },
    relations: { requests: true },
  });

  return {
    release: mapRelease(release, media ?? undefined),
    media: media ?? undefined,
  };
}

musicRoutes.get('/:mbid', async (req, res, next) => {
  try {
    const { release } = await getReleaseWithMedia(req.params.mbid);
    return res.status(200).json(release);
  } catch (e) {
    logger.debug('Something went wrong retrieving release', {
      label: 'API',
      errorMessage: e.message,
      mbid: req.params.mbid,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve release.',
    });
  }
});

musicRoutes.get('/:mbid/tracks', async (req, res, next) => {
  try {
    const { release, media } = await getReleaseWithMedia(req.params.mbid);

    return res.status(200).json({
      id: release.id,
      tracks: release.tracks.map((track) => ({
        ...track,
        status: media?.tracks?.find((t) => t.trackNumber === track.trackNumber)
          ?.status,
      })),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving release tracks', {
      label: 'API',
      errorMessage: e.message,
      mbid: req.params.mbid,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve release tracks.',
    });
  }
});

export default musicRoutes;
