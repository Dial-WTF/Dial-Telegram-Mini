// #/services/s3/listObjects.ts

import S3 from 'aws-sdk/clients/s3';

import { AWS_S3_BUCKET } from '#/config/constants';
import { s3 } from '#/services/s3/client';
import { isPlaceholder } from '#/services/s3/utils/isPlaceholder';

export async function listAllObjects(args: { folderKey: string }): Promise<string[]> {
  const { folderKey } = args;
  let isTruncated = true;
  let marker: string | undefined;
  const contents: S3.ObjectList = [];

  try {
    while (isTruncated) {
      const params: S3.ListObjectsV2Request = {
        Bucket: AWS_S3_BUCKET,
        Prefix: folderKey,
        ContinuationToken: marker,
      };

      const data = await s3.listObjectsV2(params).promise();
      contents.push(...(data.Contents ?? []));
      isTruncated = data.IsTruncated || false;
      marker = data.NextContinuationToken;
    }

    const objectKeys = contents
      .filter(({ Key = '' }) => !isPlaceholder(Key))
      .reduce((ary, { Key }) => {
        return Key ? [...ary, Key] : ary;
      }, [] as string[]);

    return objectKeys.filter((key) => !isPlaceholder(key));
  } catch (error: any) {
    console.error(`Error listing all objects: ${error.message}`);
    // throw new Error(`Error listing all objects: ${error.message}`);
    return [];
  }
}

export default listAllObjects;
