// #/services/s3/actions/createOrRetrieveUserFolder.ts

import { ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';

import { AWS_S3_BUCKET } from '#/config/constants';

import { s3 } from '..';
import { PATH_USERS } from '../filepaths';

/**
 * Creates or retrieves a user folder structure in S3.
 * @param address The wallet address of the user
 * @returns A promise resolving to a boolean indicating success
 */
export default async function createOrRetrieveUserFolder(address: string): Promise<boolean> {
  // Use string concatenation instead of path.join to ensure consistent forward slashes
  const userHome = `${PATH_USERS}${address}/`;
  const userVoicemailsFolderKey = `${userHome}voicemails/`;
  const profileKey = `${userHome}profile.json`;

  console.log(`[S3] Creating/retrieving user folder: ${userHome}`);
  console.log(`[S3] Voicemails folder: ${userVoicemailsFolderKey}`);
  console.log(`[S3] Profile key: ${profileKey}`);
  console.log(`[S3] Using bucket: ${AWS_S3_BUCKET}`);

  // Try multiple approaches to ensure the folder exists
  try {
    // First, check if the user folder already exists by using ListObjectsV2
    try {
      console.log(`[S3] Checking if user folder exists using ListObjectsV2`);
      const listCommand = new ListObjectsV2Command({
        Bucket: AWS_S3_BUCKET,
        Prefix: userHome,
        MaxKeys: 1,
      });

      const listResult = await s3.send(listCommand);
      if (listResult.Contents && listResult.Contents.length > 0) {
        console.log(`[S3] User folder exists, found ${listResult.Contents.length} objects`);

        // Check if voicemails folder exists
        const voicemailsFolderExists = listResult.Contents.some((item) =>
          item.Key?.startsWith(userVoicemailsFolderKey)
        );

        if (!voicemailsFolderExists) {
          console.log(`[S3] Voicemails folder doesn't exist, creating it`);
          await createVoicemailsFolder();
        }

        return true;
      }

      console.log(`[S3] User folder doesn't exist or is empty, creating it`);
    } catch (listErr) {
      console.warn(`[S3] Error listing user folder:`, listErr);
      // Continue to creation steps
    }

    // Create the user folder structure
    try {
      console.log(`[S3] Creating user folder and subfolders`);

      // Create user folder by putting an empty object
      const userFolderCommand = new PutObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: userHome,
        Body: '',
      });

      await s3.send(userFolderCommand);
      console.log(`[S3] Created user folder: ${userHome}`);

      // Create voicemails folder
      await createVoicemailsFolder();

      // Create an empty profile.json as a marker
      const profileCommand = new PutObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: profileKey,
        Body: JSON.stringify({}),
        ContentType: 'application/json',
      });

      await s3.send(profileCommand);
      console.log(`[S3] Created profile.json: ${profileKey}`);

      return true;
    } catch (createErr: any) {
      console.error(`[S3] Error creating user folder structure:`, createErr);
      throw createErr;
    }
  } catch (err: any) {
    console.error(`[S3] Error in createOrRetrieveUserFolder:`, err);
    return false;
  }

  // Helper function to create the voicemails folder
  async function createVoicemailsFolder() {
    try {
      const voicemailsFolderCommand = new PutObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: userVoicemailsFolderKey,
        Body: '',
      });

      await s3.send(voicemailsFolderCommand);
      console.log(`[S3] Created voicemails folder: ${userVoicemailsFolderKey}`);
    } catch (err) {
      console.error(`[S3] Error creating voicemails folder:`, err);
      throw err;
    }
  }
}
