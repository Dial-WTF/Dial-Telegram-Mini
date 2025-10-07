// ./lib/actions/simplifi/s3/createFolderExists.ts
import { AWS_S3_BUCKET } from '#/config/constants';
import { s3 } from '#/services/s3/client';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

export default async function checkFolderExists(folderKey: string): Promise<boolean> {
  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: AWS_S3_BUCKET,
      Prefix: folderKey,
      Delimiter: '/',
    })
  );

  if (result.Contents && result.Contents.length > 0) {
    return true;
  }

  if (result.CommonPrefixes && result.CommonPrefixes.length > 0) {
    return true;
  }

  return false;
}
