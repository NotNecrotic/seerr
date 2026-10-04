import MusicBrainz from '@server/api/musicbrainz';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import logger from '@server/logger';
import { mapReleaseSearchResult } from '@server/models/Music';
import { Router } from 'express';

const artistRoutes = Router();

/**
 * Artists are a derived, read-only browse entity (mirroring `Person`), so there is no
 * `Media` row for one. Only their releases can be requested.
 */

artistRoutes.get('/:mbid', async (req, res, next) => {
  try {
    const musicbrainz = new MusicBrainz();
    const artist = await musicbrainz.getArtist({ artistMbid: req.params.mbid });

    if (!artist) {
      return res.status(404).json({ message: 'Artist not found.' });
    }

    return res.status(200).json(artist);
  } catch (e) {
    logger.debug('Something went wrong retrieving artist', {
      label: 'API',
      errorMessage: e.message,
      artistMbid: req.params.mbid,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve artist.',
    });
  }
});

artistRoutes.get('/:mbid/releases', async (req, res, next) => {
  try {
    const musicbrainz = new MusicBrainz();
    const releases = await musicbrainz.getArtistReleases({
      artistMbid: req.params.mbid,
      limit: Number(req.query.limit ?? 50),
      offset: Number(req.query.offset ?? 0),
    });

    if (!releases.length) {
      return res.status(200).json([]);
    }

    // Attach Seerr-side availability to each release the same way the person page does
    // for its credits.
    const mediaRepository = getRepository(Media);
    const media = await mediaRepository.find({
      where: { mediaType: MediaType.MUSIC },
    });
    const mediaByReleaseId = new Map(media.map((m) => [m.musicBrainzId, m]));

    return res
      .status(200)
      .json(
        releases.map((release) =>
          mapReleaseSearchResult(release, mediaByReleaseId.get(release.id))
        )
      );
  } catch (e) {
    logger.debug('Something went wrong retrieving artist releases', {
      label: 'API',
      errorMessage: e.message,
      artistMbid: req.params.mbid,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve artist releases.',
    });
  }
});

export default artistRoutes;
