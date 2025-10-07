// #/services/s3/listObjects.ts

import { ListObjectsV2Command, type _Object as S3Object } from '@aws-sdk/client-s3';

import { AWS_S3_BUCKET } from '#/config/constants';
import { s3 } from '#/services/s3/client';
import { isPlaceholder } from '#/services/s3/utils/isPlaceholder';

export async function listAllObjects(args: { folderKey: string }): Promise<string[]> {
  const { folderKey } = args;
  let isTruncated = true;
  let continuationToken: string | undefined;
  const contents: S3Object[] = [];

  try {
    while (isTruncated) {
      const cmd = new ListObjectsV2Command({
        Bucket: AWS_S3_BUCKET,
        Prefix: folderKey,
        ContinuationToken: continuationToken,
      });

      const data = await s3.send(cmd);
      contents.push(...(data.Contents ?? []));
      isTruncated = Boolean(data.IsTruncated);
      continuationToken = data.NextContinuationToken;
    }

    const objectKeys = contents
      .filter(({ Key = '' }) => !isPlaceholder(Key))
      .reduce((acc: string[], { Key }) => (Key ? [...acc, Key] : acc), [] as string[]);

    return objectKeys.filter((key) => !isPlaceholder(key));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error listing all objects: ${message}`);
    return [];
  }
}

export default listAllObjects;
