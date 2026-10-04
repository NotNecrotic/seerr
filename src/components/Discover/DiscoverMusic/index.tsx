import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { MusicSearchResult } from '@server/models/Music';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.DiscoverMusic', {
  discovermusic: 'Music',
  searchplaceholder: 'Search for an album…',
  introduction:
    'Search MusicBrainz for an album to request. Music is resolved from MusicBrainz and fulfilled by Lidarr.',
});

/**
 * Music discover page.
 *
 * Unlike movies and TV, MusicBrainz has no popularity, trending, or "now playing"
 * feeds, so this is a search-first surface rather than a browsable grid. There is no
 * sort or filter control for the same reason.
 */
const DiscoverMusic = () => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const { hasPermission } = useUser();
  const [searchTerm, setSearchTerm] = useState(
    typeof router.query.query === 'string' ? router.query.query : ''
  );

  const canRequestMusic = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MUSIC],
    { type: 'or' }
  );
  const trimmedSearch = searchTerm.trim();

  // MusicBrainz is rate limited to roughly 1 request per second, so only query once
  // there is an actual term rather than on every keystroke or on page load.
  const { data, error } = useSWR<{
    results: MusicSearchResult[];
  }>(
    canRequestMusic && trimmedSearch
      ? `/api/v1/search/music?query=${encodeURIComponent(trimmedSearch)}`
      : null,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (error) {
      addToast(<span>{intl.formatMessage(globalMessages.error)}</span>, {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  }, [error, addToast, intl]);

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  const title = intl.formatMessage(messages.discovermusic);

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{title}</Header>
      </div>
      <p className="mb-6 text-sm text-gray-400">
        {intl.formatMessage(messages.introduction)}
      </p>
      <div className="mb-6 flex w-full items-center justify-center">
        <label htmlFor="music-search" className="sr-only">
          {intl.formatMessage(messages.searchplaceholder)}
        </label>
        <input
          id="music-search"
          type="search"
          autoComplete="off"
          placeholder={intl.formatMessage(messages.searchplaceholder)}
          className="block w-full max-w-xl rounded-full border border-gray-600 bg-gray-900/80 px-4 py-2 text-white placeholder-gray-300 hover:border-gray-500 focus:border-gray-500 focus:bg-gray-900 focus:outline-none focus:ring-0 sm:text-base"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyUp={(e) => {
            if (e.key === 'Enter') {
              setSearchTerm(searchTerm.trim());
            }
          }}
        />
      </div>
      <ListView
        musicItems={data?.results}
        isEmpty={!!data && data.results.length === 0}
        isLoading={!!searchTerm && !data}
      />
    </>
  );
};

export default DiscoverMusic;
