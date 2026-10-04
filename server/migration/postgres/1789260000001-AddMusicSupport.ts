import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMusicSupport1789260000001 implements MigrationInterface {
  name = 'AddMusicSupport1789260000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The music permission bits push the mask past the int4 range, so Postgres needs the
    // column widened to bigint. SQLite's INTEGER is already 64-bit, so nothing is needed
    // there and its table is left untouched.
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "permissions" TYPE bigint`
    );

    await queryRunner.query(
      `ALTER TABLE "media" ADD "musicBrainzId" character varying`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_musicBrainzId" ON "media" ("musicBrainzId")`
    );

    await queryRunner.query(
      `CREATE TABLE "track" ("id" SERIAL NOT NULL, "trackNumber" integer NOT NULL, "musicBrainzId" character varying, "status" integer NOT NULL DEFAULT '1', "mediaId" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_track_id" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_track_musicBrainzId" ON "track" ("musicBrainzId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_track_mediaId" ON "track" ("mediaId")`
    );
    await queryRunner.query(
      `ALTER TABLE "track" ADD CONSTRAINT "FK_track_media" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );

    await queryRunner.query(
      `CREATE TABLE "track_request" ("id" SERIAL NOT NULL, "trackNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT '1', "requestId" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_track_request_id" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_track_request_requestId" ON "track_request" ("requestId")`
    );
    await queryRunner.query(
      `ALTER TABLE "track_request" ADD CONSTRAINT "FK_track_request_request" FOREIGN KEY ("requestId") REFERENCES "media_request"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );

    await queryRunner.query(`ALTER TABLE "user" ADD "musicQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD "musicQuotaDays" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaDays"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaLimit"`);
    await queryRunner.query(
      `ALTER TABLE "track_request" DROP CONSTRAINT "FK_track_request_request"`
    );
    await queryRunner.query(`DROP INDEX "IDX_track_request_requestId"`);
    await queryRunner.query(`DROP TABLE "track_request"`);
    await queryRunner.query(
      `ALTER TABLE "track" DROP CONSTRAINT "FK_track_media"`
    );
    await queryRunner.query(`DROP INDEX "IDX_track_mediaId"`);
    await queryRunner.query(`DROP INDEX "IDX_track_musicBrainzId"`);
    await queryRunner.query(`DROP TABLE "track"`);
    await queryRunner.query(`DROP INDEX "IDX_media_musicBrainzId"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "musicBrainzId"`);
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "permissions" TYPE integer`
    );
  }
}
