-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('MERCHANT', 'PERSONAL');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "profile_type" "ProfileType";

-- Les comptes existants sont des commerçants.
UPDATE "merchants" SET "profile_type" = 'MERCHANT';
