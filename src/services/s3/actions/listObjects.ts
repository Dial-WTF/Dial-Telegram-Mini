// #/services/s3/listObjects.ts

import { AWS_S3_BUCKET } from '#/config/constants';
import { s3 } from '#/services/s3/client';
import { isPlaceholder } from '#/services/s3/utils/isPlaceholder';

/**
 * Returns the list of strings corresponding to the keys of the objects and optionally folders in the
 * specified folder.
 *
 * @param args
 * @param args.folderKey The folder key to list objects from.
 * @param args.includeFolders Optional. Whether to include folders in the result. Defaults to false.
 * @returns
 */
export async function listObjects(args: {
  folderKey: string;
  includeFolders?: boolean;
}): Promise<string[]> {
  try {
    const { folderKey, includeFolders = false } = args;

    const objects = await s3
      .listObjectsV2({
        Bucket: AWS_S3_BUCKET,
        Prefix: folderKey,
        Delimiter: '/',
      })
      .promise();
    // console.debug(`[listObjects] Listed objects in ${folderKey}:`, objects);

    const objectKeys: string[] = (objects.Contents ?? [])
      .filter(({ Key = '' }) => !isPlaceholder(Key))
      .reduce((ary, { Key }) => {
        return Key ? [...ary, Key] : ary;
      }, [] as string[]);

    let result = objectKeys.filter((key) => !isPlaceholder(key));

    if (includeFolders) {
      const folderKeys = (objects.CommonPrefixes ?? []).map((prefix) => prefix.Prefix ?? '');
      result = [...result, ...folderKeys];
    }

    return result;
  } catch (error: any) {
    console.error(`Error listing objects: ${error.message}`);
    // throw new Error(`Error listing objects: ${error.message}`);
    return [];
  }
}

export default listObjects;
