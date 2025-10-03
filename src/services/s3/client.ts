import { S3Client } from '@aws-sdk/client-s3';
import {
  AWS_S3_ACCESS_KEY,
  AWS_S3_BUCKET,
  AWS_S3_ENDPOINT,
  AWS_S3_REGION,
  AWS_S3_SECRET_KEY,
} from '#/config/constants';

// Log S3 configuration for diagnostics
console.log('S3 Configuration:', {
  endpoint: AWS_S3_ENDPOINT,
  region: AWS_S3_REGION,
  bucket: AWS_S3_BUCKET,
  hasAccessKey: !!AWS_S3_ACCESS_KEY,
  hasSecretKey: !!AWS_S3_SECRET_KEY,
  accessKeyLength: AWS_S3_ACCESS_KEY?.length,
  secretKeyLength: AWS_S3_SECRET_KEY?.length,
});

// Validate required configuration
if (!AWS_S3_ENDPOINT) {
  console.error('Missing AWS_S3_ENDPOINT configuration');
}
if (!AWS_S3_ACCESS_KEY) {
  console.error('Missing AWS_S3_ACCESS_KEY configuration');
}
if (!AWS_S3_SECRET_KEY) {
  console.error('Missing AWS_S3_SECRET_KEY configuration');
}
if (!AWS_S3_REGION) {
  console.error('Missing AWS_S3_REGION configuration');
}
if (!AWS_S3_BUCKET) {
  console.error('Missing AWS_S3_BUCKET configuration');
}

export const s3 = new S3Client({
  endpoint: AWS_S3_ENDPOINT,
  credentials: {
    accessKeyId: AWS_S3_ACCESS_KEY,
    secretAccessKey: AWS_S3_SECRET_KEY,
  },
  region: AWS_S3_REGION,
  forcePathStyle: true,
});


