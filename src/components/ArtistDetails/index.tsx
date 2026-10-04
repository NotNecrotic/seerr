import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import TitleCard from '@app/components/TitleCard';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { MusicBrainzArtist } from '@server/api/musicbrainz';
import type { ArtistRelease } from '@server/models/Music';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.ArtistDetails', {
  albums: 'Albums',
  lifespanspan: '{begin} – {end}',
  lifespanend: '{begin} –',
  aliases: 'Also Known As: {names}',
  genre: 'Genres',
});

/**
 * Artist browse page.
 *
 * Deliberately mirrors `PersonDetails`: artists are a derived, read-only entity with no
 * request of their own, and their page exists to reach the albums that *are* requestable.
 */
const ArtistDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const artistId = router.query.artistId as string;

  const { data, error } = useSWR<MusicBrainzArtist>(
    artistId ? `/api/v1/artist/${artistId}` : null
  );
  const { data: releases, error: releasesError } = useSWR<ArtistRelease[]>(
    artistId ? `/api/v1/artist/${artistId}/releases` : null
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const artistAttributes: string[] = [];
  if (data.begin) {
    artistAttributes.push(
      data.end
        ? intl.formatMessage(messages.lifespanspan, {
            begin: data.begin,
            end: data.end,
          })
        : intl.formatMessage(messages.lifespanend, { begin: data.begin })
    );
  }
  if (data.country) {
    artistAttributes.push(data.country);
  }
  if (data.type) {
    artistAttributes.push(data.type);
  }

  return (
    <>
      <PageTitle title={data.name} />
      <div className="mt-4 flex flex-col items-center lg:flex-row">
        {/*
          Artist art from the Cover Art Archive is square, so this uses a rounded square
          rather than the circular avatar used for people.
        */}
        <div className="relative mb-6 mr-0 h-36 w-36 flex-shrink-0 overflow-hidden rounded-xl ring-1 ring-gray-700 lg:mb-0 lg:mr-6 lg:h-44 lg:w-44">
          <CachedImage
            type="musicbrainz"
            src={data.coverArt ?? '/images/seerr_poster_not_found.png'}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            fill
          />
        </div>
        <div className="w-full text-center text-gray-300 lg:text-left">
          <div className="flex w-full items-center justify-center lg:justify-between">
            <h1 className="text-3xl text-white lg:text-4xl">{data.name}</h1>
          </div>
          <div className="mb-2 mt-1 space-y-1 text-xs text-white sm:text-sm lg:text-base">
            <div>{artistAttributes.join(' | ')}</div>
            {data.aliases.length > 0 && (
              <div>
                {intl.formatMessage(messages.aliases, {
                  names: data.aliases.join(', '),
                })}
              </div>
            )}
            {data.genres.length > 0 && (
              <div>
                {intl.formatMessage(messages.genre)}: {data.genres.join(', ')}
              </div>
            )}
            {data.disambiguation && <div>{data.disambiguation}</div>}
          </div>
        </div>
      </div>
      <div className="mt-8">
        <h2 className="heading mb-4">{intl.formatMessage(messages.albums)}</h2>
        {releasesError ? null : !releases ? (
          <LoadingSpinner />
        ) : releases.length === 0 ? (
          <p className="text-gray-400">
            {intl.formatMessage(messages.albums)}: 0
          </p>
        ) : (
          <ul className="cards-vertical">
            {releases.map((release, index) => (
              <li key={`${release.id}-${index}`}>
                <TitleCard
                  // MusicBrainz ids are UUIDs, so `id` is unused for music cards.
                  id={Number.NaN}
                  musicId={release.id}
                  image={release.posterPath}
                  status={release.mediaInfo?.status}
                  summary={release.artistName}
                  title={release.title}
                  year={release.date}
                  mediaType="music"
                  canExpand
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
};

export default ArtistDetails;
