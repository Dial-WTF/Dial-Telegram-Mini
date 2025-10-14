// Type-only import to avoid runtime resolution issues
// import type { FitViewOptions } from 'reactflow';
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

// Storj-related constants

// const defaults = {
//   STORJ_ACCESS_KEY: 'jug2bq453feggjgayikvae7tdhja',
//   STORJ_SECRET_KEY: 'j2266z7ojyupmteinwrqtl2l25scbuuly4cnz7qyklhwuqfzp4b36',
//   STORJ_BUCKET: 'dial-wtf-pre-launch',
//   STORJ_ENDPOINT: 'https://gateway.storjshare.io',
// };

// Alpha
const defaults = {
  STORJ_ACCESS_KEY: 'jug2bq453feggjgayikvae7tdhja',
  STORJ_SECRET_KEY: 'j2266z7ojyupmteinwrqtl2l25scbuuly4cnz7qyklhwuqfzp4b36',
  STORJ_BUCKET: 'dial-bot',
  STORJ_ENDPOINT: 'https://gateway.storjshare.io',
  STORJ_REGION: 'us-east-1',
  WEBHOOK_SECRET: 'test',
};

// Alpha 2
// const defaults = {
//   STORJ_ACCESS_KEY: 'jug2bq453feggjgayikvae7tdhja',
//   STORJ_SECRET_KEY:
//     'j2266z7ojyupmteinwrqtl2l25scbuuly4cnz7qyklhwuqfzp4b36',
//   STORJ_BUCKET: 'dial-wtf-pre-launch',
//   STORJ_ENDPOINT: 'https://gateway.storjshare.io',
// };
export const WEBHOOK_SECRET = process.env.NEXT_WEBHOOK_SECRET || defaults.WEBHOOK_SECRET;
export const STORJ_ACCESS_KEY = process.env.NEXT_STORJ_ACCESS_KEY || defaults.STORJ_ACCESS_KEY;
export const STORJ_SECRET_KEY = process.env.NEXT_STORJ_SECRET_KEY || defaults.STORJ_SECRET_KEY;
export const STORJ_BUCKET = process.env.NEXT_STORJ_BUCKET || defaults.STORJ_BUCKET;
export const STORJ_ENDPOINT =
  process.env.NEXT_STORJ_ENDPOINT || defaults.STORJ_ENDPOINT || 'https://gateway.storjshare.io';
export const STORJ_REGION = process.env.NEXT_STORJ_REGION || defaults.STORJ_REGION || 'us-east-1';

// // Workspace-specific Storj envs (override if provided)
// export const STORJ_WS_ACCESS_KEY = process.env.NEXT_STORJ_WORKSPACES_ACCESS_KEY || STORJ_ACCESS_KEY;
// export const STORJ_WS_SECRET_KEY = process.env.NEXT_STORJ_WORKSPACES_SECRET_KEY || STORJ_SECRET_KEY;
// export const STORJ_WS_BUCKET = process.env.NEXT_STORJ_WORKSPACES_BUCKET || STORJ_BUCKET;
// export const STORJ_WS_ENDPOINT = process.env.NEXT_STORJ_WORKSPACES_ENDPOINT || STORJ_ENDPOINT;

// S3-related constants (using Storj via S3)
export const AWS_S3_ACCESS_KEY = STORJ_ACCESS_KEY;
export const AWS_S3_SECRET_KEY = STORJ_SECRET_KEY;
export const AWS_S3_ENDPOINT = STORJ_ENDPOINT;
export const AWS_S3_BUCKET = STORJ_BUCKET;
export const AWS_S3_REGION = STORJ_REGION;

// Workspace S3 view (uses Storj S3-compatible endpoint)
// export const AWS_S3_WS_ACCESS_KEY = STORJ_WS_ACCESS_KEY;
// export const AWS_S3_WS_SECRET_KEY = STORJ_WS_SECRET_KEY;
// export const AWS_S3_WS_ENDPOINT = STORJ_WS_ENDPOINT;
// export const AWS_S3_WS_BUCKET = STORJ_WS_BUCKET;

// Feature flags & allowlists
export const ALLOW_YOUTUBE_IMPORT =
  (process.env.NEXT_PUBLIC_ALLOW_YOUTUBE_IMPORT || 'false') === 'true';
export const YOUTUBE_ALLOWED_DOMAINS: string[] = ['youtube.com', 'youtu.be'];

export const minimapStyles = {
  height: 120,
  background: '#000',
};

