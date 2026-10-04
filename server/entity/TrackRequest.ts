import { MediaRequestStatus } from '@server/constants/media';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MediaRequest } from './MediaRequest';

/**
 * A track requested as part of a music request. Mirrors `SeasonRequest`: a user can
 * request individual tracks within a release, and each carries its own approval state.
 */
@Entity()
class TrackRequest {
  @PrimaryGeneratedColumn()
  public id: number;

  /**
   * Position of the track within its release, 1-indexed, matching `Track.trackNumber`.
   */
  @Column()
  public trackNumber: number;

  @Column({ type: 'int', default: MediaRequestStatus.PENDING })
  public status: MediaRequestStatus;

  @ManyToOne(() => MediaRequest, (request) => request.tracks, {
    onDelete: 'CASCADE',
  })
  @Index()
  public request: MediaRequest;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<TrackRequest>) {
    Object.assign(this, init);
  }
}

export default TrackRequest;
