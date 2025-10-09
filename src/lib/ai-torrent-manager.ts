/**
 * Torrent functionality removed. These stubs intentionally do nothing
 * and ensure the app compiles without any torrent dependencies.
 */

import type { TorrentStats } from '@/types/ai-model';

export async function getTorrentClient(): Promise<any> {
  throw new Error('Torrent functionality is disabled');
}

export async function downloadModelTorrent(
  _modelId: string,
  _magnetUri: string,
  _downloadPath: string,
  _onProgress?: (progress: number, downloadSpeed: number, peers: number) => void
): Promise<string> {
  throw new Error('Torrent functionality is disabled');
}

export async function createModelTorrent(
  _modelId: string,
  _filePath: string,
  _onSeed?: (magnetUri: string, infoHash: string) => void
): Promise<{ magnetUri: string; infoHash: string }> {
  throw new Error('Torrent functionality is disabled');
}

export async function getTorrentStats(_infoHash: string): Promise<TorrentStats | null> {
  return null;
}

export async function stopTorrent(_infoHash: string): Promise<void> {
  return;
}

export async function resumeTorrent(
  _modelId: string,
  _magnetUri: string,
  _downloadPath: string
): Promise<void> {
  return;
}

export async function getActiveTorrents(): Promise<TorrentStats[]> {
  return [];
}

export async function destroyTorrentClient(): Promise<void> {
  return;
}
