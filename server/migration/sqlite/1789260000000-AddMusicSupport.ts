import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMusicSupport1789260000000 implements MigrationInterface {
  name = 'AddMusicSupport1789260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // MusicBrainz IDs live alongside the existing int tmdbId rather than replacing
    // it, so movies and TV keep their existing lookups untouched.
    await queryRunner.query(`ALTER TABLE "media" ADD "musicBrainzId" varchar`);
    await queryRunner.query(
      `CREATE INDEX "IDX_media_musicBrainzId" ON "media" ("musicBrainzId")`
    );

    // Tracks mirror seasons: a music media row is a release, and these are its tracks.
    await queryRunner.query(
      `CREATE TABLE "track" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "trackNumber" integer NOT NULL, "musicBrainzId" varchar, "status" integer NOT NULL DEFAULT (1), "mediaId" integer, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "FK_track_media" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_track_mediaBrainzId" ON "track" ("musicBrainzId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_track_mediaId" ON "track" ("mediaId")`
    );

    await queryRunner.query(
      `CREATE TABLE "track_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "trackNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "requestId" integer, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "FK_track_request_request" FOREIGN KEY ("requestId") REFERENCES "media_request" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_track_request_requestId" ON "track_request" ("requestId")`
    );

    await queryRunner.query(`ALTER TABLE "user" ADD "musicQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD "musicQuotaDays" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaDays"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaLimit"`);
    await queryRunner.query(`DROP INDEX "IDX_track_request_requestId"`);
    await queryRunner.query(`DROP TABLE "track_request"`);
    await queryRunner.query(`DROP INDEX "IDX_track_mediaId"`);
    await queryRunner.query(`DROP INDEX "IDX_track_mediaBrainzId"`);
    await queryRunner.query(`DROP TABLE "track"`);
    await queryRunner.query(`DROP INDEX "IDX_media_musicBrainzId"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "musicBrainzId"`);
  }
}
