import { MediaStatus } from '@server/constants/media';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import Media from './Media';

/**
 * A single track (recording) on a music `Media` row, which represents a release.
 *
 * This mirrors `Season` exactly: TV has a `Media` row per series with child seasons,
 * and music has a `Media` row per release with child tracks.
 */
@Entity()
class Track {
  @PrimaryGeneratedColumn()
  public id: number;

  /**
   * Position of the track within its release, 1-indexed. Unique per media row.
   */
  @Column()
  public trackNumber: number;

  /**
   * MusicBrainz recording ID, if known. Not all sources expose it (for example
   * Lidarr tracks are addressed by position rather than recording ID).
   */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  public musicBrainzId?: string | null;

  @Column({ type: 'int', default: MediaStatus.UNKNOWN })
  public status: MediaStatus;

  @ManyToOne(() => Media, (media) => media.tracks, {
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Promise<Media>;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<Track>) {
    Object.assign(this, init);
  }
}

export default Track;
