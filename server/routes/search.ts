import MusicBrainz, { describeApiError } from '@server/api/musicbrainz';
import TheMovieDb from '@server/api/themoviedb';
import type { TmdbSearchMultiResponse } from '@server/api/themoviedb/interfaces';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { findSearchProvider } from '@server/lib/search';
import logger from '@server/logger';
import {
  mapArtistSearchResult,
  mapReleaseSearchResult,
} from '@server/models/Music';
import { mapSearchResults, type Results } from '@server/models/Search';
import { Router } from 'express';

const searchRoutes = Router();

/**
 * Music results for a query, mapped to the same shape as TMDB results.
 *
 * Failures are swallowed so an unreachable MusicBrainz still returns TMDB results
 * rather than failing the whole search.
 */
const getMusicResults = async (
  queryString: string,
  page: number
): Promise<Results[]> => {
  const musicbrainz = new MusicBrainz();

  try {
    const [releases, artists] = await Promise.all([
      musicbrainz.searchReleases({
        query: queryString,
        limit: 20,
        offset: (page - 1) * 20,
      }),
      musicbrainz.searchArtists({
        query: queryString,
        limit: 20,
        offset: (page - 1) * 20,
      }),
    ]);

    // Attach Seerr-side request/availability state. Music rows are keyed on
    // musicBrainzId rather than tmdbId, so this cannot use getRelatedMedia.
    const mediaRepository = getRepository(Media);
    const media = await mediaRepository.find({
      where: { mediaType: MediaType.MUSIC },
    });
    const mediaByReleaseId = new Map(media.map((m) => [m.musicBrainzId, m]));

    return [
      ...releases.map((release) =>
        mapReleaseSearchResult(release, mediaByReleaseId.get(release.id))
      ),
      ...artists.map(mapArtistSearchResult),
    ];
  } catch (e) {
    logger.debug('Something went wrong retrieving music search results', {
      label: 'API',
      errorMessage: describeApiError(e),
      query: queryString,
    });

    return [];
  }
};

searchRoutes.get('/', async (req, res, next) => {
  const queryString = req.query.query as string;
  const searchProvider = findSearchProvider(queryString.toLowerCase());
  const page = Number(req.query.page ?? 1) || 1;
  let results: TmdbSearchMultiResponse;

  try {
    if (searchProvider) {
      const [id] = queryString
        .toLowerCase()
        .match(searchProvider.pattern) as RegExpMatchArray;
      results = await searchProvider.search({
        id,
        language: (req.query.language as string) ?? req.locale,
        query: queryString,
      });
    } else {
      const tmdb = new TheMovieDb();

      results = await tmdb.searchMulti({
        query: queryString,
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
      });
    }

    const media = await Media.getRelatedMedia(
      req.user,
      results.results.map((result) => ({
        tmdbId: result.id,
        mediaType: result.media_type,
      }))
    );

    const mappedResults = mapSearchResults(results.results, media);

    // Music lives in MusicBrainz rather than TMDB, so it is resolved separately and
    // merged into the same envelope. It is fetched concurrently with the TMDB work
    // above; `getMusicResults` swallows its own errors so a MusicBrainz outage
    // degrades to TMDB-only results rather than a 500.
    const musicResults = await getMusicResults(queryString, page);

    return res.status(200).json({
      page: results.page,
      totalPages: results.total_pages,
      totalResults: results.total_results + musicResults.length,
      results: [...mappedResults, ...musicResults],
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving search results', {
      label: 'API',
      errorMessage: e.message,
      query: req.query.query,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve search results.',
    });
  }
});

// Artists are music metadata rather than video metadata, so they get their own
// endpoint rather than being mixed into the multi-search envelope above.
searchRoutes.get('/artist', async (req, res, next) => {
  const musicbrainz = new MusicBrainz();

  try {
    const artists = await musicbrainz.searchArtists({
      query: req.query.query as string,
      limit: 20,
      offset: Number(req.query.page ?? 0) * 20,
    });

    return res.status(200).json({
      page: Number(req.query.page ?? 0) + 1,
      totalPages: 1,
      totalResults: artists.length,
      results: artists,
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving artist search results', {
      label: 'API',
      errorMessage: describeApiError(e),
      query: req.query.query,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve artist search results.',
    });
  }
});

// Music releases are searched through MusicBrainz rather than TMDB, and live on their
// own endpoint because the two APIs have incompatible result shapes.
searchRoutes.get('/music', async (req, res, next) => {
  const musicbrainz = new MusicBrainz();

  try {
    const releases = await musicbrainz.searchReleases({
      query: req.query.query as string,
      limit: 20,
      offset: Number(req.query.page ?? 0) * 20,
    });

    if (releases.length === 0) {
      return res.status(200).json({
        page: 1,
        totalPages: 0,
        totalResults: 0,
        results: [],
      });
    }

    // Attach Seerr-side request/availability state. Music rows are keyed on
    // musicBrainzId rather than tmdbId, so this cannot use getRelatedMedia.
    const mediaRepository = getRepository(Media);
    const media = await mediaRepository.find({
      where: { mediaType: MediaType.MUSIC },
    });
    const mediaByReleaseId = new Map(media.map((m) => [m.musicBrainzId, m]));

    return res.status(200).json({
      page: Number(req.query.page ?? 0) + 1,
      totalPages: 1,
      totalResults: releases.length,
      results: releases.map((release) =>
        mapReleaseSearchResult(release, mediaByReleaseId.get(release.id))
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving music search results', {
      label: 'API',
      errorMessage: describeApiError(e),
      query: req.query.query,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve music search results.',
    });
  }
});

searchRoutes.get('/keyword', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const results = await tmdb.searchKeyword({
      query: req.query.query as string,
      page: Number(req.query.page),
    });

    return res.status(200).json(results);
  } catch (e) {
    logger.debug('Something went wrong retrieving keyword search results', {
      label: 'API',
      errorMessage: e.message,
      query: req.query.query,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve keyword search results.',
    });
  }
});

searchRoutes.get('/company', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const results = await tmdb.searchCompany({
      query: req.query.query as string,
      page: Number(req.query.page),
    });

    return res.status(200).json(results);
  } catch (e) {
    logger.debug('Something went wrong retrieving company search results', {
      label: 'API',
      errorMessage: e.message,
      query: req.query.query,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve company search results.',
    });
  }
});

export default searchRoutes;
