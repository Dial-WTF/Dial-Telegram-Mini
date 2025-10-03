// src/services/s3/utils/isJsonPath.ts

export function isJsonPath(path: string | any) {
  return typeof path === 'string' && path.endsWith('.json');
}
