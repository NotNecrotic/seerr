/* eslint-disable no-console */
/**
 * Live end-to-end check for the music API routes.
 *
 * Requires a server already running (default http://localhost:5055) and drives the
 * real endpoints with a real session, so the OpenAPI validator, auth middleware, and
 * handlers are all exercised together. This is what catches issues a unit test or a
 * YAML parse would not.
 *
 *   NODE_ENV=test npx ts-node -r tsconfig-paths/register --files \
 *     --project server/tsconfig.json server/scripts/checkMusicRoutes.ts
 */
const BASE = process.env.CHECK_BASE_URL ?? 'http://localhost:5055';

const failures: string[] = [];

const check = (name: string, condition: boolean, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures.push(name);
  }
};

interface Session {
  cookie: string;
  csrf: string;
}

const login = async (): Promise<Session | undefined> => {
  // Prime cookies the way a browser would. CSRF protection is off by default, so there
  // may be no XSRF token to read; the login request is sent regardless and the session
  // cookie is taken from its response.
  const prime = await fetch(`${BASE}/api/v1/settings/public`);
  const setCookie = prime.headers.get('set-cookie') ?? '';
  const xsrf = /XSRF-TOKEN=([^;]+)/.exec(setCookie)?.[1];
  const primedSession = /connect.sid=([^;]+)/.exec(setCookie)?.[1];

  const res = await fetch(`${BASE}/api/v1/auth/local`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: xsrf
        ? `XSRF-TOKEN=${xsrf}; connect.sid=${primedSession ?? ''}`
        : '',
      ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
    },
    body: JSON.stringify({ email: 'admin@seerr.dev', password: 'test1234' }),
  });

  if (!res.ok) {
    console.log(`  (login returned ${res.status})`);
    return undefined;
  }

  // Node's fetch does not keep cookies between calls, so carry them explicitly.
  const body = res.headers.get('set-cookie') ?? '';
  const sessionId = /connect.sid=([^;]+)/.exec(body)?.[1];
  const finalXsrf = /XSRF-TOKEN=([^;]+)/.exec(body)?.[1] ?? xsrf;

  if (!sessionId) {
    console.log('  (login succeeded but no session cookie was set)');
    return undefined;
  }

  return {
    cookie: [
      `connect.sid=${sessionId}`,
      ...(finalXsrf ? [`XSRF-TOKEN=${finalXsrf}`] : []),
    ].join('; '),
    csrf: finalXsrf ?? '',
  };
};

const get = async (
  session: Session,
  path: string
): Promise<{ status: number; body: unknown }> => {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      cookie: session.cookie,
      ...(session.csrf ? { 'X-XSRF-TOKEN': session.csrf } : {}),
    },
  });

  let body: unknown;

  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  return { status: res.status, body: body as unknown };
};

const main = async () => {
  const session = await login();

  if (!session) {
    console.error(
      'Could not obtain a session. Start the server and seed a test admin first.'
    );
    process.exitCode = 1;
    return;
  }

  const arr = (body: unknown): Record<string, unknown>[] =>
    (body as { results?: Record<string, unknown>[] })?.results ?? [];

  console.log('GET /api/v1/discover/music');
  const discover = await get(session, '/api/v1/discover/music?page=1');
  check('returns 200', discover.status === 200, `status ${discover.status}`);
  const discoverResults = arr(discover.body);
  check(
    'returns results',
    discoverResults.length > 0,
    `${discoverResults.length}`
  );
  check(
    'results are mapped releases',
    discoverResults.every(
      (r) => typeof r.id === 'string' && r.title !== undefined
    )
  );
  check(
    'includes popularity and rating',
    discoverResults.every(
      (r) => typeof r.popularity === 'number' && typeof r.rating === 'number'
    )
  );

  console.log('GET /api/v1/search/music');
  const search = await get(session, '/api/v1/search/music?query=abbey%20road');
  check('returns 200', search.status === 200, `status ${search.status}`);
  const searchResults = arr(search.body);
  check('returns results', searchResults.length > 0, `${searchResults.length}`);

  console.log('GET /api/v1/search/artist');
  const artistSearch = await get(
    session,
    '/api/v1/search/artist?query=beatles'
  );
  check(
    'returns 200',
    artistSearch.status === 200,
    `status ${artistSearch.status}`
  );
  const artistResults = arr(artistSearch.body);
  check('returns results', artistResults.length > 0, `${artistResults.length}`);

  if (artistResults.length) {
    const artistId = artistResults[0].id as string;

    console.log('GET /api/v1/artist/:mbid');
    const artist = await get(session, `/api/v1/artist/${artistId}`);
    check('returns 200', artist.status === 200, `status ${artist.status}`);

    console.log('GET /api/v1/artist/:mbid/releases');
    const artistReleases = await get(
      session,
      `/api/v1/artist/${artistId}/releases`
    );
    check(
      'returns 200',
      artistReleases.status === 200,
      `status ${artistReleases.status}`
    );
    check(
      'returns releases',
      Array.isArray(artistReleases.body) && artistReleases.body.length > 0,
      `${(artistReleases.body as unknown[] | undefined)?.length ?? 0}`
    );
  }

  if (searchResults.length) {
    const releaseId = searchResults[0].id as string;

    console.log('GET /api/v1/music/:mbid');
    const release = await get(session, `/api/v1/music/${releaseId}`);
    check('returns 200', release.status === 200, `status ${release.status}`);
    const releaseTracks = (release.body as { tracks?: unknown[] })?.tracks;
    check(
      'includes a track listing',
      Array.isArray(releaseTracks) && releaseTracks.length > 0,
      `${releaseTracks?.length ?? 0} tracks`
    );

    console.log('GET /api/v1/music/:mbid/tracks');
    const tracks = await get(session, `/api/v1/music/${releaseId}/tracks`);
    check('returns 200', tracks.status === 200, `status ${tracks.status}`);
  }

  console.log('GET /api/v1/settings/lidarr');
  const lidarr = await get(session, '/api/v1/settings/lidarr');
  check('returns 200', lidarr.status === 200, `status ${lidarr.status}`);
  check('is an array', Array.isArray(lidarr.body));

  console.log('GET /api/v1/service/lidarr');
  const service = await get(session, '/api/v1/service/lidarr');
  check('returns 200', service.status === 200, `status ${service.status}`);

  console.log('');
  if (failures.length) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('All music route checks passed.');
  }
};

main().catch((e) => {
  console.error('Harness error:', e.message);
  process.exitCode = 1;
});
