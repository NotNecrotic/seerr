import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import RequestModal from '@app/components/RequestModal';
import StatusBadge from '@app/components/StatusBadge';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { MediaStatus } from '@server/constants/media';
import type { MusicDetails as MusicDetailsType } from '@server/models/Music';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.MusicDetails', {
  releases: 'Tracks',
  releasegroup: 'Release Group',
  requestedtracks: 'Requested Tracks',
  notavailable: 'This album is not available yet.',
});

const MusicDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const [requestModal, setRequestModal] = useState(false);
  const musicId = router.query.musicId as string;

  const { data, error } = useSWR<MusicDetailsType>(
    musicId ? `/api/v1/music/${musicId}` : null
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const status = data.mediaInfo?.status;
  const hasRequestable =
    !status || status === MediaStatus.UNKNOWN || status === MediaStatus.DELETED;
  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MUSIC],
    { type: 'or' }
  );

  return (
    <>
      <RequestModal
        // Music has no TMDB id; the release is identified by its MusicBrainz id.
        tmdbId={0}
        musicBrainzId={data.id}
        show={requestModal}
        type="music"
        onComplete={() => {
          setRequestModal(false);
          router.reload();
        }}
        onCancel={() => setRequestModal(false)}
      />
      <PageTitle title={data.title} />
      <div className="mt-4 flex flex-col items-center lg:flex-row">
        {/*
          Album art is square, unlike the vertical posters used for movies and TV, so
          this hero is a rounded square rather than a portrait.
        */}
        <div className="relative mb-4 mr-0 h-64 w-64 flex-shrink-0 overflow-hidden rounded-xl ring-1 ring-gray-700 lg:mb-0 lg:mr-6 lg:h-80 lg:w-80">
          <CachedImage
            type="musicbrainz"
            src={data.posterPath ?? '/images/seerr_poster_not_found.png'}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            fill
          />
        </div>
        <div className="w-full text-center lg:text-left">
          <h1 className="mb-1 text-2xl font-bold text-white lg:text-3xl">
            {data.title}
          </h1>
          {data.artistId ? (
            <Link
              href={`/artist/${data.artistId}`}
              className="text-base text-indigo-400 hover:text-indigo-300"
            >
              {data.artistName}
            </Link>
          ) : (
            <div className="text-base text-gray-400">{data.artistName}</div>
          )}
          <div className="mb-3 mt-2 space-y-1 text-xs text-white sm:text-sm lg:text-base">
            {data.date && <div>{data.date.slice(0, 4)}</div>}
            <div>
              {data.trackCount ?? data.tracks.length}{' '}
              {intl.formatMessage(messages.releases)}
            </div>
            {data.disambiguation && <div>{data.disambiguation}</div>}
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-2 lg:justify-start">
            {data.mediaInfo && (
              <StatusBadge
                mediaType="music"
                status={data.mediaInfo.status}
                tmdbId={data.mediaInfo.id}
              />
            )}
            {canRequest && hasRequestable && (
              <Button
                buttonType="primary"
                onClick={() => setRequestModal(true)}
              >
                {intl.formatMessage(globalMessages.request)}
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-8">
        <h2 className="heading mb-2">
          {intl.formatMessage(messages.releases)}
        </h2>
        <ul className="rounded-lg border border-gray-700 bg-gray-800/50">
          {data.tracks.map((track) => {
            const trackStatus = data.mediaInfo?.tracks?.find(
              (t) => t.trackNumber === track.trackNumber
            )?.status;

            return (
              <li
                key={track.trackNumber}
                className="flex items-center gap-3 border-b border-gray-700 px-4 py-2 last:border-b-0"
              >
                <span className="w-6 shrink-0 text-right text-sm text-gray-400">
                  {track.trackNumber}
                </span>
                <span className="flex-1 truncate text-sm text-gray-200">
                  {track.title}
                </span>
                {trackStatus === MediaStatus.AVAILABLE && (
                  <Badge className="border-green-600 bg-green-600/80 text-white">
                    {intl.formatMessage(globalMessages.available)}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
};

export default MusicDetails;
