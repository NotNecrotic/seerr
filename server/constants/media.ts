export enum MediaRequestStatus {
  PENDING = 1,
  APPROVED,
  DECLINED,
  FAILED,
  COMPLETED,
}

export enum MediaType {
  MOVIE = 'movie',
  TV = 'tv',
  MUSIC = 'music',
}

/**
 * Sorting options for the music discover page.
 *
 * MusicBrainz has no server-side sort parameter, so results are sorted in process
 * after being fetched. Popularity comes from ListenBrainz and is only available when
 * an admin has configured a token.
 *
 * Lives here rather than in the route so the client can import it without pulling in
 * server-only Express type augmentation.
 */
export const MusicSortOptionsIterable = [
  'popularity.asc',
  'popularity.desc',
  'releaseDate.asc',
  'releaseDate.desc',
  'rating.asc',
  'rating.desc',
  'title.asc',
  'title.desc',
] as const;

export type MusicSortOptions = (typeof MusicSortOptionsIterable)[number];

export enum MediaStatus {
  UNKNOWN = 1,
  PENDING,
  PROCESSING,
  PARTIALLY_AVAILABLE,
  AVAILABLE,
  BLOCKLISTED,
  DELETED,
}
