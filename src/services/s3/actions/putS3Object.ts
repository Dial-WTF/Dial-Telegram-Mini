// #/services/s3/actions/putS3Object.ts

import { PutObjectCommand } from '@aws-sdk/client-s3';
import throttle from 'lodash.throttle';

import { s3 } from '#/services/s3/client';

// This part checks if the environment is Node.js
const isNode =
  typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

/**
 * Converts data to appropriate format for S3 upload
 * Simplified for browser compatibility
 */
function dataToStream(data: any) {
  // For browser environments, just return the data as-is
  // S3 SDK handles the conversion internally
  return data;
}

/**
 * Uploads an object to Amazon S3.
 *
 * @param {Object} putObjectParams - Parameters for the putObject operation.
 * @returns {Promise<Object>} - A promise that resolves with the result of the putObject operation.
 */
export async function putS3Object(putObjectParams: any) {
  try {
    // Use the body directly - AWS SDK handles the conversion
    const command = new PutObjectCommand(putObjectParams);
    return await s3.send(command);
  } catch (error: any) {
    console.error('S3 putObject error:', error);
    throw new Error(`Error putting S3 object: ${error.message || error}`);
  }
}

export const putS3ObjectThrottled = throttle(putS3Object, 300);

export default putS3Object;
