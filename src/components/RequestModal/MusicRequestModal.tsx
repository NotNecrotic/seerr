import Alert from '@app/components/Common/Alert';
import Modal from '@app/components/Common/Modal';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission } from '@server/lib/permissions';
import type { MusicDetails } from '@server/models/Music';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal', {
  requestadmin: 'This request will be approved automatically.',
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestCancel: 'Request for <strong>{title}</strong> canceled.',
  requestmusictitle: 'Request Music',
  edit: 'Edit Request',
  approve: 'Approve Request',
  cancel: 'Cancel Request',
  pendingrequest: 'Pending Music Request',
  requestfrom: "{username}'s request is pending approval.",
  errorediting: 'Something went wrong while editing the request.',
  requestedited: 'Request for <strong>{title}</strong> edited successfully!',
  requestApproved: 'Request for <strong>{title}</strong> approved!',
  requesterror: 'Something went wrong while submitting the request.',
  pendingapproval: 'Your request is pending approval.',
  selecttracks: 'Tracks',
  selectall: 'Select All',
  deselectall: 'Clear All',
});

interface RequestModalProps extends React.HTMLAttributes<HTMLDivElement> {
  tmdbId: number;
  /**
   * MusicBrainz release ID. Music has no TMDB id, so this identifies the release. It
   * falls back to the edit request's media when opening an existing request.
   */
  musicBrainzId?: string;
  editRequest?: NonFunctionProperties<MediaRequest>;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const MusicRequestModal = ({
  onCancel,
  onComplete,
  tmdbId,
  musicBrainzId,
  onUpdating,
  editRequest,
}: RequestModalProps) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [requestOverrides, setRequestOverrides] =
    useState<RequestOverrides | null>(null);
  // Tracks default to fully selected, matching the "request the whole album" default.
  const [selectedTracks, setSelectedTracks] = useState<number[]>([]);
  const { addToast } = useToasts();
  const intl = useIntl();
  const { user, hasPermission } = useUser();

  const releaseId = musicBrainzId ?? editRequest?.media?.musicBrainzId;

  const { data, error } = useSWR<MusicDetails>(
    releaseId ? `/api/v1/music/${releaseId}` : null,
    { revalidateOnMount: true }
  );

  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id || hasPermission(Permission.MANAGE_USERS))
      ? `/api/v1/user/${requestOverrides?.user?.id ?? user.id}/quota`
      : null
  );

  useEffect(() => {
    if (onUpdating) {
      onUpdating(isUpdating);
    }
  }, [isUpdating, onUpdating]);

  // Seed the selection once tracks load, and when editing, to what was requested.
  useEffect(() => {
    if (!data?.tracks?.length) {
      return;
    }

    if (editRequest?.tracks?.length) {
      setSelectedTracks(editRequest.tracks.map((track) => track.trackNumber));
    } else {
      setSelectedTracks(data.tracks.map((track) => track.trackNumber));
    }
  }, [data, editRequest]);

  const sendRequest = useCallback(async () => {
    setIsUpdating(true);

    try {
      let overrideParams = {};
      if (requestOverrides) {
        overrideParams = {
          serverId: requestOverrides.server,
          profileId: requestOverrides.profile,
          rootFolder: requestOverrides.folder,
          userId: requestOverrides.user?.id,
          tags: requestOverrides.tags,
        };
      }

      await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: data?.id,
        musicBrainzId: data?.id,
        mediaType: 'music',
        tracks: selectedTracks,
        // Music has no 4K variant.
        is4k: false,
        ignoreQuota: requestOverrides?.ignoreQuota,
        ...overrideParams,
      });
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (onComplete) {
        onComplete(
          hasPermission(Permission.AUTO_APPROVE) ||
            hasPermission(Permission.AUTO_APPROVE_MUSIC)
            ? MediaStatus.PROCESSING
            : MediaStatus.PENDING
        );
      }
      addToast(
        <span>
          {intl.formatMessage(messages.requestSuccess, {
            title: data?.title,
            strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
    } catch {
      addToast(intl.formatMessage(messages.requesterror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  }, [
    requestOverrides,
    data?.id,
    data?.title,
    selectedTracks,
    onComplete,
    addToast,
    intl,
    hasPermission,
  ]);

  const cancelRequest = async () => {
    setIsUpdating(true);

    try {
      const response = await axios.delete<MediaRequest>(
        `/api/v1/request/${editRequest?.id}`
      );
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (response.status === 204) {
        if (onComplete) {
          onComplete(MediaStatus.UNKNOWN);
        }
        addToast(
          <span>
            {intl.formatMessage(messages.requestCancel, {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      setIsUpdating(false);
    }
  };

  const updateRequest = async (alsoApproveRequest = false) => {
    setIsUpdating(true);

    try {
      await axios.put(`/api/v1/request/${editRequest?.id}`, {
        mediaType: 'music',
        serverId: requestOverrides?.server,
        profileId: requestOverrides?.profile,
        rootFolder: requestOverrides?.folder,
        userId: requestOverrides?.user?.id,
        tags: requestOverrides?.tags,
      });

      if (alsoApproveRequest) {
        await axios.post(`/api/v1/request/${editRequest?.id}/approve`);
      }
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      addToast(
        <span>
          {intl.formatMessage(
            alsoApproveRequest
              ? messages.requestApproved
              : messages.requestedited,
            {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            }
          )}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );

      if (onComplete) {
        onComplete(MediaStatus.PENDING);
      }
    } catch {
      addToast(<span>{intl.formatMessage(messages.errorediting)}</span>, {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleTrack = (trackNumber: number) => {
    setSelectedTracks((current) =>
      current.includes(trackNumber)
        ? current.filter((track) => track !== trackNumber)
        : [...current, trackNumber].sort((a, b) => a - b)
    );
  };

  const toggleAllTracks = () => {
    setSelectedTracks((current) =>
      current.length === (data?.tracks.length ?? 0)
        ? []
        : (data?.tracks.map((track) => track.trackNumber) ?? [])
    );
  };

  const hasAutoApprove =
    hasPermission(Permission.AUTO_APPROVE) ||
    hasPermission(Permission.AUTO_APPROVE_MUSIC);

  const trackSelector = (data?.tracks.length ?? 0) > 0 && (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">
          {intl.formatMessage(messages.selecttracks)}
        </span>
        <button
          type="button"
          className="text-xs text-indigo-400 hover:text-indigo-300"
          onClick={toggleAllTracks}
        >
          {intl.formatMessage(
            selectedTracks.length === (data?.tracks.length ?? 0)
              ? messages.deselectall
              : messages.selectall
          )}
        </button>
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-gray-700 p-2">
        {data?.tracks.map((track) => (
          <label
            key={track.trackNumber}
            className="flex cursor-pointer items-center gap-2 text-sm text-gray-300"
          >
            <input
              type="checkbox"
              className="form-checkbox rounded-sm border-gray-500 bg-gray-800 text-indigo-500 focus:ring-2 focus:ring-indigo-400 focus:ring-offset-0"
              checked={selectedTracks.includes(track.trackNumber)}
              onChange={() => toggleTrack(track.trackNumber)}
            />
            <span className="w-6 shrink-0 text-right text-gray-400">
              {track.trackNumber}
            </span>
            <span className="truncate">{track.title}</span>
          </label>
        ))}
      </div>
    </div>
  );

  if (editRequest) {
    const isOwner = editRequest.requestedBy.id === user?.id;

    return (
      <Modal
        loading={!data && !error}
        backgroundClickable
        onCancel={onCancel}
        title={intl.formatMessage(messages.pendingrequest)}
        subTitle={data?.title}
        onOk={() =>
          hasPermission(Permission.MANAGE_REQUESTS)
            ? updateRequest(true)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? updateRequest()
              : cancelRequest()
        }
        okDisabled={isUpdating}
        okText={
          hasPermission(Permission.MANAGE_REQUESTS)
            ? intl.formatMessage(messages.approve)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? intl.formatMessage(messages.edit)
              : intl.formatMessage(messages.cancel)
        }
        okButtonType={
          hasPermission(Permission.MANAGE_REQUESTS)
            ? 'success'
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? 'primary'
              : 'danger'
        }
        onSecondary={
          isOwner &&
          hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
            ? () => cancelRequest()
            : undefined
        }
        secondaryDisabled={isUpdating}
        secondaryText={
          isOwner &&
          hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
            ? intl.formatMessage(messages.cancel)
            : undefined
        }
        secondaryButtonType="danger"
        cancelText={intl.formatMessage(globalMessages.close)}
      >
        {isOwner
          ? intl.formatMessage(messages.pendingapproval)
          : intl.formatMessage(messages.requestfrom, {
              username: editRequest.requestedBy.displayName,
            })}
        {hasPermission(
          [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        ) && (
          <AdvancedRequester
            type="lidarr"
            tmdbId={tmdbId}
            // Music has no 4K variant.
            is4k={false}
            requestUser={editRequest.requestedBy}
            requestId={editRequest.id}
            defaultOverrides={{
              folder: editRequest.rootFolder,
              profile: editRequest.profileId,
              tags: editRequest.tags,
            }}
            onChange={setRequestOverrides}
          />
        )}
      </Modal>
    );
  }

  return (
    <Modal
      loading={!data && !error}
      backgroundClickable
      onCancel={onCancel}
      title={
        hasAutoApprove && !quota?.music.restricted
          ? intl.formatMessage(messages.requestadmin)
          : intl.formatMessage(messages.requestmusictitle)
      }
      subTitle={data?.title}
      onOk={sendRequest}
      okDisabled={isUpdating || selectedTracks.length === 0}
      okButtonType={'primary'}
      cancelText={intl.formatMessage(globalMessages.cancel)}
    >
      {hasAutoApprove && !quota?.music.restricted ? (
        <Alert title={intl.formatMessage(messages.requestadmin)} type="info" />
      ) : (
        <>
          <QuotaDisplay
            quota={quota?.music}
            mediaType="music"
            remaining={selectedTracks.length}
          />
          {trackSelector}
        </>
      )}
    </Modal>
  );
};

export default MusicRequestModal;
