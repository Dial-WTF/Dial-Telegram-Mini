// ./lib/actions/simplifi/s3/index.ts
// Description: This file is the entry point for all the actions related to the S3 service
import checkFileExists from './checkFileExists';
import checkFolderExists from './checkFolderExists';
import createOrRetrieveUserFolder from './createOrRetrieveUserFolder';
import deleteFile from './deleteFile';
import getSignedUrl from './getSignedUrl';
import listAllObjects from './listAllObjects';
import listObjects from './listObjects';
import putS3Object from './putS3Object';
import writeFile from './writeFile';

export {
  checkFileExists,
  checkFolderExists,
  createOrRetrieveUserFolder,
  deleteFile,
  getSignedUrl,
  listAllObjects,
  listObjects,
  putS3Object,
  writeFile,
};

const S3 = {
  checkFileExists,
  checkFolderExists,
  createOrRetrieveUserFolder,
  deleteFile,
  getSignedUrl,
  listAllObjects,
  listObjects,
  putS3Object,
  writeFile,
};

export default S3;
