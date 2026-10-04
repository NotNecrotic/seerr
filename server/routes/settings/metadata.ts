import MusicBrainz from '@server/api/musicbrainz';
import TheMovieDb from '@server/api/themoviedb';
import Tvdb from '@server/api/tvdb';
import {
  getSettings,
  MetadataProviderType,
  type MetadataSettings,
} from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

function getTestResultString(testValue: number): string {
  if (testValue === -1) return 'not tested';
  if (testValue === 0) return 'failed';
  return 'ok';
}

const metadataRoutes = Router();

metadataRoutes.get('/', (_req, res) => {
  const settings = getSettings();
  res.status(200).json({
    tv: settings.metadataSettings.tv,
    anime: settings.metadataSettings.anime,
    // MusicBrainz is always used for music and takes no configuration, so this is a
    // read-only signal for the UI rather than a selectable provider.
    music: MetadataProviderType.MUSICBRAINZ,
  });
});

metadataRoutes.put('/', async (req, res) => {
  const settings = getSettings();
  const body = req.body as MetadataSettings;

  let tvdbTest = -1;
  let tmdbTest = -1;

  try {
    if (
      body.tv === MetadataProviderType.TVDB ||
      body.anime === MetadataProviderType.TVDB
    ) {
      tvdbTest = 0;
      const tvdb = await Tvdb.getInstance();
      await tvdb.test();
      tvdbTest = 1;
    }
  } catch (e) {
    logger.error('Failed to test metadata provider', {
      label: 'Metadata',
      message: e.message,
    });
  }

  try {
    if (
      body.tv === MetadataProviderType.TMDB ||
      body.anime === MetadataProviderType.TMDB
    ) {
      tmdbTest = 0;
      const tmdb = new TheMovieDb();
      await tmdb.getTvShow({ tvId: 1054 });
      tmdbTest = 1;
    }
  } catch (e) {
    logger.error('Failed to test metadata provider', {
      label: 'MetadataProvider',
      message: e.message,
    });
  }

  // If a test failed, return the test results
  if (tvdbTest === 0 || tmdbTest === 0) {
    return res.status(500).json({
      success: false,
      tests: {
        tvdb: getTestResultString(tvdbTest),
        tmdb: getTestResultString(tmdbTest),
      },
    });
  }

  settings.metadataSettings = {
    tv: body.tv,
    anime: body.anime,
  };
  await settings.save();

  res.status(200).json({
    success: true,
    tv: body.tv,
    anime: body.anime,
    tests: {
      tvdb: getTestResultString(tvdbTest),
      tmdb: getTestResultString(tmdbTest),
    },
  });
});

metadataRoutes.post('/test', async (req, res) => {
  let tvdbTest = -1;
  let tmdbTest = -1;
  // MusicBrainz is always in use for music, so it is tested on request rather than
  // being driven by a selected provider.
  let musicbrainzTest = -1;

  try {
    const body = req.body as {
      tmdb: boolean;
      tvdb: boolean;
      musicbrainz?: boolean;
    };

    try {
      if (body.musicbrainz) {
        musicbrainzTest = 0;
        const musicbrainz = new MusicBrainz();
        musicbrainzTest = (await musicbrainz.test()) ? 1 : 0;
      }
    } catch (e) {
      logger.error('Failed to test metadata provider', {
        label: 'MetadataProvider',
        errorMessage: e.message,
      });
    }

    try {
      if (body.tmdb) {
        tmdbTest = 0;
        const tmdb = new TheMovieDb();
        await tmdb.getTvShow({ tvId: 1054 });
        tmdbTest = 1;
      }
    } catch (e) {
      logger.error('Failed to test metadata provider', {
        label: 'MetadataProvider',
        message: e.message,
      });
    }

    try {
      if (body.tvdb) {
        tvdbTest = 0;
        const tvdb = await Tvdb.getInstance();
        await tvdb.test();
        tvdbTest = 1;
      }
    } catch (e) {
      logger.error('Failed to test metadata provider', {
        label: 'MetadataProvider',
        message: e.message,
      });
    }

    const success = !(
      tvdbTest === 0 ||
      tmdbTest === 0 ||
      musicbrainzTest === 0
    );
    const statusCode = success ? 200 : 500;

    return res.status(statusCode).json({
      success: success,
      tests: {
        tmdb: getTestResultString(tmdbTest),
        tvdb: getTestResultString(tvdbTest),
        musicbrainz: getTestResultString(musicbrainzTest),
      },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      tests: {
        tmdb: getTestResultString(tmdbTest),
        tvdb: getTestResultString(tvdbTest),
        musicbrainz: getTestResultString(musicbrainzTest),
      },
      error: e.message,
    });
  }
});

export default metadataRoutes;
