import type {
  MusicBrainzArtist,
  MusicBrainzRelease,
  MusicBrainzTrack,
} from '@server/api/musicbrainz';
import type Media from '@server/entity/Media';
import type Track from '@server/entity/Track';

/**
 * A release (album) as returned by the music API.
 *
 * Music has no notion of a TMDB id or a popularity score, so the shape is deliberately
 * smaller than `MovieDetails` / `TvDetails`.
 */
export interface MusicDetails {
  id: string;
  title: string;
  artistName: string;
  artistId: string;
  releaseGroupId: string;
  date?: string;
  country?: string;
  status?: string;
  disambiguation?: string;
  trackCount?: number;
  tracks: MusicBrainzTrack[];
  /** Cover Art Archive URL, or undefined when the release has no cover. */
  posterPath?: string;
  backdropPath?: string;
  mediaInfo?: Media;
  /** Per-track availability, attached to each entry of `trackStatus`. */
  trackStatus?: TrackStatus[];
}

export interface TrackStatus {
  trackNumber: number;
  status: number;
}

/** A search result for a release, before full details are fetched. */
export interface MusicSearchResult {
  id: string;
  mediaType: 'music';
  title: string;
  artistName: string;
  artistId: string;
  releaseGroupId: string;
  date?: string;
  posterPath?: string;
  backdropPath?: string;
  mediaInfo?: Media;
}

/**
 * An artist as a search result.
 *
 * Artists are browse-only: there is no requestable Media row, so unlike a person
 * result this carries no `knownFor` list and no `mediaInfo`.
 */
export interface ArtistSearchResult {
  id: string;
  mediaType: 'artist';
  name: string;
  sortName?: string;
  type?: string;
  country?: string;
  disambiguation?: string;
  begin?: string;
  end?: string;
  firstReleaseDate?: string;
  genres: string[];
  posterPath?: string;
}

export interface ArtistRelease {
  id: string;
  title: string;
  artistName: string;
  artistId: string;
  releaseGroupId: string;
  date?: string;
  posterPath?: string;
  mediaInfo?: Media;
}

export const mapRelease = (
  release: MusicBrainzRelease,
  media?: Media
): MusicDetails => ({
  id: release.id,
  title: release.title,
  artistName: release.artistName,
  artistId: release.artistId,
  releaseGroupId: release.releaseGroupId,
  date: release.date,
  country: release.country,
  status: release.status,
  disambiguation: release.disambiguation,
  trackCount: release.trackCount,
  tracks: release.tracks,
  posterPath: release.coverArt,
  mediaInfo: media,
});

export const mapReleaseSearchResult = (
  release: MusicBrainzRelease,
  media?: Media
): MusicSearchResult => ({
  id: release.id,
  mediaType: 'music',
  title: release.title,
  artistName: release.artistName,
  artistId: release.artistId,
  releaseGroupId: release.releaseGroupId,
  date: release.date,
  posterPath: release.coverArt,
  mediaInfo: media,
});

export const mapArtistSearchResult = (
  artist: MusicBrainzArtist
): ArtistSearchResult => ({
  id: artist.id,
  mediaType: 'artist',
  name: artist.name,
  sortName: artist.sortName,
  type: artist.type,
  country: artist.country,
  disambiguation: artist.disambiguation,
  begin: artist.begin,
  end: artist.end,
  firstReleaseDate: artist.firstReleaseDate,
  genres: artist.genres ?? [],
  // The list renderer reads `posterPath`; MusicBrainz names the same field `coverArt`.
  posterPath: artist.coverArt,
});

export const mapArtist = (artist: MusicBrainzArtist): MusicBrainzArtist => ({
  ...artist,
});

export type { Track };
