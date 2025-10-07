import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getPresignedUrl } from '@aws-sdk/s3-request-presigner';

import { AWS_S3_BUCKET } from '#/config/constants';
import { s3 } from '#/services/s3/client';

export async function getSignedUrl(objectKey: string): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: objectKey,
    });

    const signedUrl = await getPresignedUrl(s3, command, {
      expiresIn: 60 * 5, // URL expires in 5 minutes
    });

    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw new Error('Failed to generate signed URL');
  }
}

export default getSignedUrl;
