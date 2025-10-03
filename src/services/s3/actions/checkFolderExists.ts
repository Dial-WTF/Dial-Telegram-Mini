// ./lib/actions/simplifi/s3/createFolderExists.ts
import { AWS_S3_BUCKET } from '#/config/constants';
import { s3 } from '#/services/s3/client';

export default async function checkFolderExists(folderKey: string): Promise<boolean> {
  const result = await s3
    .listObjects({
      Bucket: AWS_S3_BUCKET,
      Prefix: folderKey,
      Delimiter: '/',
    })
    .promise();

  if (result.Contents && result.Contents.length > 0) {
    return true;
  }

  if (result.CommonPrefixes && result.CommonPrefixes.length > 0) {
    return true;
  }

  return false;
}
