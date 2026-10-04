import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import MusicFilterSlideover from '@app/components/Discover/MusicFilterSlideover';
import {
  countActiveFilters,
  prepareFilterValues,
} from '@app/components/Discover/constants';
import useDiscover from '@app/hooks/useDiscover';
import useSettings from '@app/hooks/useSettings';
import { useUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import { BarsArrowDownIcon, FunnelIcon } from '@heroicons/react/24/solid';
import type { MusicSortOptions } from '@server/constants/media';
import type { MusicSearchResult } from '@server/models/Music';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMusic', {
  discovermusic: 'Music',
  activefilters:
    '{count, plural, one {# Active Filter} other {# Active Filters}}',
  sortPopularityAsc: 'Popularity Ascending',
  sortPopularityDesc: 'Popularity Descending',
  sortReleaseDateAsc: 'Release Date Ascending',
  sortReleaseDateDesc: 'Release Date Descending',
  sortRatingAsc: 'MusicBrainz Rating Ascending',
  sortRatingDesc: 'MusicBrainz Rating Descending',
  sortTitleAsc: 'Title (A-Z) Ascending',
  sortTitleDesc: 'Title (Z-A) Descending',
  loaderror: 'Something went wrong loading music releases.',
  nopopularity:
    'Popularity sorting requires a ListenBrainz user token in Settings → General. Showing release date order instead.',
});

const SortOptions: Record<string, MusicSortOptions> = {
  PopularityAsc: 'popularity.asc',
  PopularityDesc: 'popularity.desc',
  ReleaseDateAsc: 'releaseDate.asc',
  ReleaseDateDesc: 'releaseDate.desc',
  RatingAsc: 'rating.asc',
  RatingDesc: 'rating.desc',
  TitleAsc: 'title.asc',
  TitleDesc: 'title.desc',
} as const;

/**
 * Music discover page.
 *
 * Mirrors the movies and shows pages: same ListView, same sort dropdown, and an
 * equivalent filter slideover backed by MusicBrainz rather than TMDB.
 *
 * MusicBrainz has no server-side sort, so the server fetches a bounded candidate pool
 * and sorts in process. Popularity additionally needs a ListenBrainz token, so those
 * options are hidden when no token is configured.
 */
const DiscoverMusic = () => {
  const intl = useIntl();
  const router = useRouter();
  const { currentSettings } = useSettings();
  const updateQueryParams = useUpdateQueryParams({});
  const [showFilters, setShowFilters] = useState(false);

  const preparedFilters = prepareFilterValues(router.query);

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<MusicSearchResult, unknown, { sortBy?: string }>(
    '/api/v1/discover/music',
    preparedFilters
  );

  const popularityAvailable = currentSettings.listenbrainzEnabled;
  const effectiveSort =
    preparedFilters.sortBy ??
    (popularityAvailable
      ? SortOptions.PopularityDesc
      : SortOptions.ReleaseDateDesc);

  const title = intl.formatMessage(messages.discovermusic);

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{title}</Header>
        <div className="mt-2 flex flex-grow flex-col sm:flex-row lg:flex-grow-0">
          <div className="mb-2 flex flex-grow sm:mr-2 lg:flex-grow-0">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <BarsArrowDownIcon className="h-6 w-6" />
            </span>
            <select
              id="sortBy"
              name="sortBy"
              className="rounded-r-only"
              value={effectiveSort}
              onChange={(e) => updateQueryParams('sortBy', e.target.value)}
            >
              {popularityAvailable && (
                <>
                  <option value={SortOptions.PopularityDesc}>
                    {intl.formatMessage(messages.sortPopularityDesc)}
                  </option>
                  <option value={SortOptions.PopularityAsc}>
                    {intl.formatMessage(messages.sortPopularityAsc)}
                  </option>
                </>
              )}
              <option value={SortOptions.ReleaseDateDesc}>
                {intl.formatMessage(messages.sortReleaseDateDesc)}
              </option>
              <option value={SortOptions.ReleaseDateAsc}>
                {intl.formatMessage(messages.sortReleaseDateAsc)}
              </option>
              <option value={SortOptions.RatingDesc}>
                {intl.formatMessage(messages.sortRatingDesc)}
              </option>
              <option value={SortOptions.RatingAsc}>
                {intl.formatMessage(messages.sortRatingAsc)}
              </option>
              <option value={SortOptions.TitleAsc}>
                {intl.formatMessage(messages.sortTitleAsc)}
              </option>
              <option value={SortOptions.TitleDesc}>
                {intl.formatMessage(messages.sortTitleDesc)}
              </option>
            </select>
          </div>
          <div className="mb-2 flex flex-grow sm:mr-2 lg:flex-grow-0">
            <MusicFilterSlideover
              show={showFilters}
              currentFilters={preparedFilters}
              onClose={() => setShowFilters(false)}
            />
            <Button onClick={() => setShowFilters(true)} className="w-full">
              <FunnelIcon />
              <span>
                {intl.formatMessage(messages.activefilters, {
                  count: countActiveFilters(preparedFilters),
                })}
              </span>
            </Button>
          </div>
        </div>
      </div>
      {!popularityAvailable && (
        <p className="mb-4 text-sm text-amber-400">
          {intl.formatMessage(messages.nopopularity)}
        </p>
      )}
      <ListView
        musicItems={titles}
        isEmpty={isEmpty}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={fetchMore}
      />
      {error && (
        <p className="mt-4 text-center text-sm text-red-400">
          {intl.formatMessage(messages.loaderror)}
        </p>
      )}
    </>
  );
};

export default DiscoverMusic;
