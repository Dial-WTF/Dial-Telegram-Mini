// #/services/s3/actions/deleteFile.ts

import { DeleteObjectCommand } from '@aws-sdk/client-s3';

import { AWS_S3_BUCKET } from '#/config/constants';

import { s3 } from '..';

/**
 * Deletes a file from an S3 bucket.
 * @param params - The parameters needed to delete the file.
 * @param params.s3ObjectKey - The key (path) of the file to be deleted in the S3 bucket.
 */
export async function deleteFile(params: { s3ObjectKey: string }): Promise<any> {
  const { s3ObjectKey } = params;

  try {
    const deleteCommand = new DeleteObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: s3ObjectKey,
    });

    const result = await s3.send(deleteCommand);

    if (result.$metadata.httpStatusCode !== 204) {
      throw new Error(`[deleteFile] Failed to delete file: ${s3ObjectKey}`);
    }

    console.info(`[deleteFile] Successfully deleted file: ${s3ObjectKey}`);
    return result;
  } catch (error) {
    const err = error as Error;
    console.error(`Failed to delete file: ${s3ObjectKey}`, err);
    throw new Error(`Failed to delete file: ${err.message}`);
  }
}

export default deleteFile;
