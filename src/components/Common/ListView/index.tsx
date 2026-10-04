import ArtistCard from '@app/components/ArtistCard';
import PersonCard from '@app/components/PersonCard';
import TitleCard from '@app/components/TitleCard';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { Permission, useUser } from '@app/hooks/useUser';
import useVerticalScroll from '@app/hooks/useVerticalScroll';
import globalMessages from '@app/i18n/globalMessages';
import { MediaStatus } from '@server/constants/media';
import type { WatchlistItem } from '@server/interfaces/api/discoverInterfaces';
import type {
  ArtistSearchResult,
  MusicSearchResult,
} from '@server/models/Music';
import type {
  CollectionResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { useIntl } from 'react-intl';

interface ListViewProps {
  items?: (TvResult | MovieResult | PersonResult | CollectionResult)[];
  /**
   * Music results are rendered by their own card because MusicBrainz releases have a
   * different shape (artist name, no TMDB id) and square cover art.
   */
  musicItems?: MusicSearchResult[];
  /**
   * Artists are browse-only entities with no requestable Media row, so they render
   * through their own card rather than `TitleCard`.
   */
  artistItems?: ArtistSearchResult[];
  plexItems?: WatchlistItem[];
  isEmpty?: boolean;
  isLoading?: boolean;
  isReachingEnd?: boolean;
  onScrollBottom?: () => void;
  mutateParent?: () => void;
}

const ListView = ({
  items,
  musicItems,
  artistItems,
  isEmpty,
  isLoading,
  onScrollBottom,
  isReachingEnd,
  plexItems,
  mutateParent,
}: ListViewProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  useVerticalScroll(
    onScrollBottom ?? (() => undefined),
    !isLoading && !isEmpty && !isReachingEnd
  );

  const blocklistVisibility = hasPermission(
    [Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST],
    { type: 'or' }
  );

  return (
    <>
      {isEmpty && (
        <div className="mt-64 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(globalMessages.noresults)}
        </div>
      )}
      <ul className="cards-vertical">
        {plexItems?.map((title, index) => {
          return (
            <li key={`${title.ratingKey}-${index}`}>
              <TmdbTitleCard
                id={title.tmdbId}
                tmdbId={title.tmdbId}
                type={title.mediaType}
                isAddedToWatchlist={true}
                canExpand
                mutateParent={mutateParent}
              />
            </li>
          );
        })}
        {items
          ?.filter((title) => {
            if (!blocklistVisibility)
              return (
                (title as TvResult | MovieResult).mediaInfo?.status !==
                MediaStatus.BLOCKLISTED
              );
            return title;
          })
          .map((title, index) => {
            let titleCard: React.ReactNode;

            switch (title.mediaType) {
              case 'movie':
                titleCard = (
                  <TitleCard
                    key={title.id}
                    id={title.id}
                    isAddedToWatchlist={
                      title.mediaInfo?.watchlists?.length ?? 0
                    }
                    image={title.posterPath}
                    status={title.mediaInfo?.status}
                    summary={title.overview}
                    title={title.title}
                    userScore={title.voteAverage}
                    year={title.releaseDate}
                    mediaType={title.mediaType}
                    inProgress={
                      (title.mediaInfo?.downloadStatus ?? []).length > 0
                    }
                    canExpand
                  />
                );
                break;
              case 'tv':
                titleCard = (
                  <TitleCard
                    key={title.id}
                    id={title.id}
                    isAddedToWatchlist={
                      title.mediaInfo?.watchlists?.length ?? 0
                    }
                    image={title.posterPath}
                    status={title.mediaInfo?.status}
                    summary={title.overview}
                    title={title.name}
                    userScore={title.voteAverage}
                    year={title.firstAirDate}
                    mediaType={title.mediaType}
                    inProgress={
                      (title.mediaInfo?.downloadStatus ?? []).length > 0
                    }
                    canExpand
                  />
                );
                break;
              case 'collection':
                titleCard = (
                  <TitleCard
                    id={title.id}
                    image={title.posterPath}
                    summary={title.overview}
                    title={title.title}
                    mediaType={title.mediaType}
                    canExpand
                  />
                );
                break;
              case 'person':
                titleCard = (
                  <PersonCard
                    personId={title.id}
                    name={title.name}
                    profilePath={title.profilePath}
                    canExpand
                  />
                );
                break;
            }

            return <li key={`${title.id}-${index}`}>{titleCard}</li>;
          })}
        {musicItems
          ?.filter((title) =>
            blocklistVisibility
              ? true
              : title.mediaInfo?.status !== MediaStatus.BLOCKLISTED
          )
          .map((title, index) => (
            <li key={`music-${title.id}-${index}`}>
              <TitleCard
                // MusicBrainz ids are UUIDs, so this is a string rather than the
                // integer ids the other media types use.
                id={Number.NaN}
                musicId={title.id}
                image={title.posterPath}
                status={title.mediaInfo?.status}
                summary={title.artistName}
                title={title.title}
                year={title.date}
                mediaType="music"
                inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
                canExpand
              />
            </li>
          ))}
        {artistItems?.map((title, index) => (
          <li key={`artist-${title.id}-${index}`}>
            <ArtistCard
              artistId={title.id}
              name={title.name}
              subName={title.disambiguation}
              profilePath={title.posterPath}
              canExpand
            />
          </li>
        ))}
        {isLoading &&
          !isReachingEnd &&
          [...Array(20)].map((_item, i) => (
            <li key={`placeholder-${i}`}>
              <TitleCard.Placeholder canExpand />
            </li>
          ))}
      </ul>
    </>
  );
};

export default ListView;
