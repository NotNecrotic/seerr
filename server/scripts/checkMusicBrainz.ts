/* eslint-disable no-console */
/**
 * Live-API smoke check for the MusicBrainz client.
 *
 * Run manually against the real service to confirm the response envelope handling and
 * mapping are correct. Not part of the automated suite because it depends on a third
 * party being reachable.
 *
 *   npx ts-node -r tsconfig-paths/register --project server/tsconfig.json \
 *     server/scripts/checkMusicBrainz.ts
 */
import MusicBrainz from '@server/api/musicbrainz';
import { getSettings } from '@server/lib/settings';

const failures: string[] = [];

const check = (name: string, condition: boolean, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures.push(name);
  }
};

const main = async () => {
  getSettings();
  const mb = new MusicBrainz();

  console.log('test()');
  check('reports the service as reachable', await mb.test());

  console.log('browseReleases()');
  const browsed = await mb.browseReleases({ limit: 5 });
  check('returns results', browsed.length > 0, `${browsed.length} releases`);
  check(
    'has ids',
    browsed.every((r) => !!r.id)
  );
  check(
    'has titles',
    browsed.every((r) => !!r.title)
  );
  check(
    'resolves artist names',
    browsed.every((r) => !!r.artistName),
    browsed[0]?.artistName
  );
  check(
    'resolves release-group ids',
    browsed.every((r) => !!r.releaseGroupId),
    browsed[0]?.releaseGroupId
  );

  console.log('browseReleases() with a date range filter');
  const ranged = await mb.browseReleases({
    releaseDateGte: '1990',
    releaseDateLte: '1995',
    limit: 5,
  });
  check('returns results', ranged.length > 0, `${ranged.length} releases`);
  check(
    'dates fall in range',
    ranged.every((r) => !r.date || (r.date >= '1990' && r.date <= '1995-12')),
    ranged.map((r) => r.date).join(', ')
  );

  console.log('searchReleases()');
  const searched = await mb.searchReleases({ query: 'abbey road', limit: 5 });
  check('returns results', searched.length > 0, `${searched.length} releases`);

  console.log('searchArtists()');
  const artists = await mb.searchArtists({ query: 'beatles', limit: 5 });
  check('returns results', artists.length > 0, `${artists.length} artists`);
  check(
    'has names',
    artists.every((a) => !!a.name),
    artists[0]?.name
  );
  check(
    'has cover art urls',
    artists.every((a) => !!a.coverArt)
  );

  if (artists[0]) {
    console.log(`getArtist() for ${artists[0].name}`);
    const artist = await mb.getArtist({ artistMbid: artists[0].id });
    check('resolves', !!artist, artist?.name);

    if (artist) {
      console.log('getArtistReleases()');
      const releases = await mb.getArtistReleases({
        artistMbid: artist.id,
        artistName: artist.name,
        limit: 5,
      });
      check(
        'returns results',
        releases.length > 0,
        `${releases.length} releases`
      );
      check(
        'attributes the artist name',
        releases.every((r) => r.artistName === artist.name),
        releases[0]?.artistName
      );
      check(
        'attributes the artist id',
        releases.every((r) => r.artistId === artist.id),
        releases[0]?.artistId
      );
    }
  }

  console.log('getRelease() with track listing');
  if (browsed[0]) {
    const release = await mb.getRelease({ releaseMbid: browsed[0].id });
    check('resolves', !!release, release.title);
    check(
      'has tracks',
      release.tracks.length > 0,
      `${release.tracks.length} tracks`
    );
    check(
      'tracks are numbered from 1',
      release.tracks.every((t) => t.trackNumber >= 1),
      release.tracks[0]?.title
    );
  }

  console.log('');
  if (failures.length) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('All MusicBrainz checks passed.');
  }
};

main().catch((e) => {
  console.error('Harness error:', e.message);
  process.exitCode = 1;
});
