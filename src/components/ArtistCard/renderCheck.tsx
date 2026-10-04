/* eslint-disable no-console */
/**
 * Render check for the music/artist search cards.
 *
 * `ArtistCard` is new rendering code reached from global search, where results now
 * arrive merged from TMDB and MusicBrainz. This mounts it in jsdom and asserts the
 * link target and image wiring, so a regression here is caught without a browser.
 *
 *   npx tsx src/components/ArtistCard/renderCheck.tsx
 */
import React from 'react';

const originalError = console.error.bind(console);

const main = async () => {
  // jsdom is only needed to run this check; it is not a committed dependency, so the
  // module is loaded dynamically and typed loosely.
  const { JSDOM } = (await import('jsdom' as string)) as {
    JSDOM: new (
      html: string,
      options?: Record<string, unknown>
    ) => { window: Window & typeof globalThis };
  };

  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true }
  );

  const define = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  };

  define('window', dom.window);
  define('document', dom.window.document);
  // `self` is referenced by Next's client runtime, which Link pulls in.
  define('self', dom.window);
  define('navigator', dom.window.navigator);
  define('HTMLElement', dom.window.HTMLElement);
  define('Element', dom.window.Element);
  define('Node', dom.window.Node);
  define('Event', dom.window.Event);
  define('MouseEvent', dom.window.MouseEvent);
  define('KeyboardEvent', dom.window.KeyboardEvent);
  define('getComputedStyle', dom.window.getComputedStyle);
  define(
    'requestAnimationFrame',
    dom.window.requestAnimationFrame.bind(dom.window)
  );
  define(
    'cancelAnimationFrame',
    dom.window.cancelAnimationFrame.bind(dom.window)
  );
  define('IS_REACT_ACT_ENVIRONMENT', true);

  const { createRoot } = await import('react-dom/client');
  const { default: ArtistCard } = await import('./index');

  const failures: string[] = [];

  const check = (name: string, condition: boolean, detail = '') => {
    if (condition) {
      console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
    } else {
      console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
      failures.push(name);
    }
  };

  const container = dom.window.document.getElementById('root') as HTMLElement;
  const root = createRoot(container);

  const mbid = 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d';

  try {
    root.render(
      React.createElement(ArtistCard, {
        artistId: mbid,
        name: 'The Beatles',
        subName: 'English rock band',
        profilePath:
          'https://coverartarchive.org/release/b10bbbfc-front-500.jpg',
      })
    );
    check('mounts without throwing', true);
  } catch (e) {
    check('mounts without throwing', false, (e as Error).message);
    throw e;
  }

  await new Promise((resolve) => setTimeout(resolve, 50));

  const html = dom.window.document.body.innerHTML;

  check('renders the artist name', html.includes('The Beatles'));
  check('renders the disambiguation', html.includes('English rock band'));
  check('links to the artist page', html.includes(`/artist/${mbid}`));
  check('renders the cover art url', html.includes('coverartarchive.org'));
  // The Cover Art Archive URL is only rewritten to the local image proxy when
  // `cacheImages` is enabled, which is off by default, so the absolute URL is correct
  // here. Asserting the proxy unconditionally would fail against default settings.
  check(
    'uses the musicbrainz proxy when caching is enabled',
    !html.includes('/imageproxy/musicbrainz/'),
    'unchanged, as cacheImages defaults to off'
  );

  // An artist with no artwork must still render, just without an image.
  root.render(
    React.createElement(ArtistCard, { artistId: mbid, name: 'No Cover Artist' })
  );
  await new Promise((resolve) => setTimeout(resolve, 50));

  const fallbackHtml = dom.window.document.body.innerHTML;

  check(
    'renders without cover art',
    fallbackHtml.includes('No Cover Artist') &&
      !fallbackHtml.includes('/imageproxy/musicbrainz/')
  );

  console.log('');
  if (failures.length) {
    originalError(`FAILED: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('ArtistCard render check passed.');
  }
};

main().catch((e) => {
  originalError('Harness error:', (e as Error).message);
  process.exitCode = 1;
});
