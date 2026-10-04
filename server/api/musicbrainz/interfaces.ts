/**
 * Raw MusicBrainz Web Service (v2) response shapes.
 *
 * MusicBrainz returns sparse records depending on the `inc` query parameters used, so
 * most fields are optional and callers must handle their absence.
 */

/** A MusicBrainz entity reference: just an ID plus a name and optional type. */
export interface MbEntity {
  id: string;
  name?: string;
  'type-id'?: string;
  type?: string;
}

export interface MbArtistCredit {
  name: string;
  artist: MbEntity;
  joinphrase?: string;
}

/** `artist-credit` as returned in search results (may be a bare string). */
export type MbArtistCreditSearch = string | MbArtistCredit;

export interface MbReleaseGroup {
  id: string;
  title: string;
  'first-release-date'?: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'artist-credit'?: MbArtistCreditSearch[];
  artist?: MbEntity;
  releases?: MbReleaseSearchResult[];
}

export interface MbReleaseSearchResult {
  id: string;
  title: string;
  date?: string;
  country?: string;
  status?: string;
  barcode?: string;
  'text-representation'?: string;
  'release-group'?: MbReleaseGroup;
  artist?: MbEntity;
  'artist-credit'?: MbArtistCreditSearch[];
  media?: MbMedia[];
  'track-count'?: number;
}

export interface MbMedia {
  format?: string;
  'track-count'?: number;
  'disc-count'?: number;
  position?: number;
  title?: string;
}

export interface MbReleaseTrack {
  id: string;
  number?: string;
  position?: number;
  length?: number;
  title: string;
  type?: string;
  'artist-credit'?: MbArtistCreditSearch[];
  recording?: MbRecording;
}

export interface MbRecording {
  id: string;
  title: string;
  length?: number;
  video?: string;
}

export interface MbReleaseDetails {
  id: string;
  title: string;
  date?: string;
  country?: string;
  status?: string;
  barcode?: string;
  disambiguation?: string;
  'text-representation'?: string;
  'release-group'?: MbReleaseGroup;
  artist?: MbEntity;
  'artist-credit'?: MbArtistCreditSearch[];
  media?: MbMedia[];
  label?: { id: string; name: string }[];
  'label-info'?: {
    'catalog-number'?: string;
    label?: { id: string; name: string };
  }[];
  recording?: MbReleaseTrack[];
  'recording-count'?: number;
  tracks?: MbReleaseTrack[];
}

export interface MbArtistDetails {
  id: string;
  name: string;
  'sort-name'?: string;
  disambiguation?: string;
  country?: string;
  area?: { id: string; name: string };
  'begin-area'?: { id: string; name: string };
  'life-span'?: { begin?: string; end?: string };
  type?: string;
  gender?: string;
  'is-group'?: string;
  tags?: { id: string; name: string; count?: number }[];
  aliases?: { name: string; locale?: string; primary?: string }[];
  'first-release-date'?: string;
  relations?: MbArtistRelation[];
}

export interface MbArtistRelation {
  type?: string;
  direction?: string;
  'target-type'?: string;
  artist?: MbEntity;
  begin?: string;
  end?: string;
  ended?: string;
  'attribute-values'?: Record<string, string>;
  attributes?: string[];
}

export interface MbArtistSearchResult {
  id: string;
  name: string;
  'sort-name'?: string;
  type?: string;
  disambiguation?: string;
  country?: string;
  gender?: string;
  score?: number;
  'first-release-date'?: string;
  'life-span'?: { begin?: string; end?: string };
  tags?: string[];
  releases?: MbReleaseSearchResult[];
}

/** Search response envelope. */
export interface MbSearchResponse<T> {
  created?: string;
  count: number;
  offset: number;
  results: T[];
}
