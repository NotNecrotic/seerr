import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type {
  ArtistSearchResult,
  MusicSearchResult,
} from '@server/models/Music';
import type {
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Search', {
  search: 'Search',
  searchresults: 'Search Results',
});

type SearchResult =
  | MovieResult
  | TvResult
  | PersonResult
  | MusicSearchResult
  | ArtistSearchResult;

const Search = () => {
  const intl = useIntl();
  const router = useRouter();

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<SearchResult>(
    `/api/v1/search`,
    {
      query: router.query.query,
    },
    { hideAvailable: false, hideBlocklisted: false, hideRequested: false }
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  // `/api/v1/search` returns TMDB and MusicBrainz results in one envelope, but the
  // list renders music and artists through their own cards, so split them out here.
  const tmdbResults = titles.filter(
    (title) => title.mediaType !== 'music' && title.mediaType !== 'artist'
  ) as (MovieResult | TvResult | PersonResult)[];
  const musicResults = titles.filter(
    (title) => title.mediaType === 'music'
  ) as MusicSearchResult[];
  const artistResults = titles.filter(
    (title) => title.mediaType === 'artist'
  ) as ArtistSearchResult[];

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.search)} />
      <div className="mb-5 mt-1">
        <Header>{intl.formatMessage(messages.searchresults)}</Header>
      </div>
      <ListView
        items={tmdbResults}
        musicItems={musicResults}
        artistItems={artistResults}
        isEmpty={isEmpty}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={fetchMore}
      />
    </>
  );
};

export default Search;
