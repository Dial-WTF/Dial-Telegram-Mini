// #/services/s3/actions/checkFileExists.ts
import { HeadObjectCommand } from '@aws-sdk/client-s3';

import { AWS_S3_BUCKET } from '#/config/constants';
import { s3 } from '#/services/s3/client';

export default async function checkFileExists(args: { s3ObjectKey: string }): Promise<boolean> {
  const { s3ObjectKey } = args;
  try {
    const command = new HeadObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: s3ObjectKey,
    });
    await s3.send(command);
    return true;
  } catch (err: any) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    } else {
      console.error(`Error checking file existence: ${err}`);
      return false;
    }
  }
}
