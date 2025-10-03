// #/services/s3/writeFile.ts

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { AWS_S3_BUCKET, AWS_S3_ENDPOINT } from '#/config/constants';
import { s3 } from '#/services/s3/client';

export async function writeFile(
  s3ObjectKey: string,
  putS3ObjectOptions: {
    Body: Buffer | Blob;
    ContentType: string;
    ContentEncoding?: string;
  } & Record<string, any>
): Promise<any> {
  console.log(`[S3:writeFile] Starting upload to ${s3ObjectKey}`);
  console.log(`[S3:writeFile] Using bucket: ${AWS_S3_BUCKET}`);
  console.log(`[S3:writeFile] Using endpoint: ${AWS_S3_ENDPOINT}`);

  try {
    // Ensure we have a valid body
    if (!putS3ObjectOptions.Body) {
      throw new Error('Missing Body in upload options');
    }

    // Create the put command
    const putCommand = new PutObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: s3ObjectKey,
      ...putS3ObjectOptions,
    });

    console.log(`[S3:writeFile] Sending upload command to S3...`);
    console.log(`[S3:writeFile] Command details:`, {
      Bucket: AWS_S3_BUCKET,
      Key: s3ObjectKey,
      ContentType: putS3ObjectOptions.ContentType,
      BodySize:
        putS3ObjectOptions.Body instanceof Buffer ? putS3ObjectOptions.Body.length : 'unknown',
    });

    // Upload the file
    try {
      const putResult = await s3.send(putCommand);
      console.log(`[S3:writeFile] Upload successful:`, putResult.$metadata);
    } catch (putError: any) {
      console.error(`[S3:writeFile] Upload failed:`, putError);
      // More detailed logging of the error
      console.error('[S3:writeFile] Error details:', {
        name: putError.name,
        message: putError.message,
        code: putError.code,
        statusCode: putError.$metadata?.httpStatusCode,
        requestId: putError.$metadata?.requestId,
        retryable: putError.$metadata?.retryable,
        stack: putError.stack,
      });
      throw putError;
    }

    // Create a command to get the object
    const getCommand = new GetObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: s3ObjectKey,
    });

    console.log(`[S3:writeFile] Generating signed URL...`);

    // Generate a signed URL for the uploaded file
    let signedUrl = '';
    try {
      signedUrl = await getSignedUrl(s3, getCommand, {
        expiresIn: 604799, // URL expiry time in seconds
      });
      console.log(`[S3:writeFile] Signed URL generated successfully`);
    } catch (signError: any) {
      console.error(`[S3:writeFile] Failed to generate signed URL:`, signError);
      console.error('[S3:writeFile] Error details:', {
        name: signError.name,
        message: signError.message,
        code: signError.code,
        statusCode: signError.$metadata?.httpStatusCode,
        requestId: signError.$metadata?.requestId,
        stack: signError.stack,
      });
      // Continue without signed URL, we'll use the public URL instead
    }

    // Construct the public URL for the uploaded file
    const publicUrl = `${AWS_S3_ENDPOINT}/${AWS_S3_BUCKET}/${s3ObjectKey}`;
    console.log(`[S3:writeFile] Public URL: ${publicUrl}`);

    console.log('[S3:writeFile] File successfully uploaded to S3');

    return { signedUrl, publicUrl };
  } catch (error: any) {
    console.error(`[S3:writeFile] Error:`, error);
    console.error('[S3:writeFile] Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      statusCode: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId,
      retryable: error.$metadata?.retryable,
      stack: error.stack,
    });
    throw new Error(`Error uploading file: ${error.message}`);
  }
}

export default writeFile;
