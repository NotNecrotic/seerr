/* eslint-disable no-console */
/**
 * Render check for the Lidarr settings modal.
 *
 * The modal's root `Transition` previously used `as={Transition}`, which makes Headless
 * UI pass a ref to a function component that cannot receive one; mounting the modal
 * threw before any fields were visible. This mounts the real component in jsdom and
 * fails if rendering throws, if React logs a ref warning, or if expected fields are
 * missing from the DOM.
 *
 * The shared `Modal` reads layout from `document` on render, so this has to be a real
 * client render rather than server-side rendering.
 *
 *   npx tsx src/components/Settings/LidarrModal/renderCheck.tsx
 */
import { JSDOM } from 'jsdom';
import React from 'react';

// jsdom globals must exist before react-dom is imported.
const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  }
);

// `navigator` is a getter-only property on modern Node, so assign via defineProperty.
const define = (key: string, value: unknown) => {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
};

define('window', dom.window);
define('document', dom.window.document);
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

const main = async () => {
  // Imported here so the jsdom globals above are in place first.
  const { createRoot } = await import('react-dom/client');
  const { IntlProvider } = await import('react-intl');
  const { default: LidarrModal } = await import('./index');

  const failures: string[] = [];

  const check = (name: string, condition: boolean, detail = '') => {
    if (condition) {
      console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
    } else {
      console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
      failures.push(name);
    }
  };

  // Headless UI registers this warning when it hands a ref to a component that cannot
  // take one, which is exactly the bug being guarded against.
  const originalError = console.error;
  const consoleErrors: string[] = [];

  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
    originalError(...args);
  };

  const container = dom.window.document.getElementById('root') as HTMLElement;
  const root = createRoot(container);

  const lidarr = {
    id: 1,
    name: 'Lidarr',
    hostname: 'localhost',
    port: 8686,
    useSsl: false,
    apiKey: 'test-key',
    baseUrl: '/',
    activeProfileId: 1,
    activeDirectory: '/music',
    tags: [] as number[],
    isDefault: true,
    syncEnabled: false,
    preventSearch: false,
    tagRequests: false,
  };

  const element = React.createElement(
    IntlProvider,
    { locale: 'en', messages: {}, defaultLocale: 'en' },
    React.createElement(LidarrModal, {
      lidarr,
      onClose: () => undefined,
      onSave: () => Promise.resolve(),
    })
  );

  try {
    // Flush synchronously; the modal's form renders on first commit.
    (root as unknown as { render: (n: React.ReactNode) => void }).render(
      element
    );
    check('mounts without throwing', true);
  } catch (e) {
    check('mounts without throwing', false, (e as Error).message);
    console.error = originalError;
    throw e;
  }

  // Let effects settle so portals and transitions have run.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const html = dom.window.document.body.innerHTML;

  check(
    'renders the name field',
    html.includes('id="name"'),
    `${html.length} bytes`
  );
  check('renders the hostname field', html.includes('id="hostname"'));
  check('renders the api key field', html.includes('id="apiKey"'));
  check('renders the root folder field', html.includes('id="rootFolder"'));

  const refWarnings = consoleErrors.filter((e) =>
    /function components cannot be given refs|cannot be given refs/i.test(e)
  );

  check(
    'no ref warnings from React',
    refWarnings.length === 0,
    refWarnings[0]?.slice(0, 120)
  );

  console.error = originalError;

  console.log('');
  if (failures.length) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('LidarrModal render check passed.');
  }
};

main().catch((e) => {
  originalError('Harness error:', (e as Error).message);
  process.exitCode = 1;
});
