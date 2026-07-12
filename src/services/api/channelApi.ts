import { apiClient } from './apiClient';
import { syncChannelsOverSocket } from './channelSocketClient';
import { RawChannelDocument, Channel, normalizeChannel } from '../../types/channel';

function normalizeBatch(docs: RawChannelDocument[], startIndex: number): Channel[] {
  const channels: Channel[] = [];
  docs.forEach((doc, i) => {
    try {
      channels.push(normalizeChannel(doc, startIndex + i));
    } catch (e) {
      console.warn('[channelApi] Failed to normalize doc at index', startIndex + i, e);
    }
  });
  return channels;
}

// Matches the backend's CHANNEL_FIRST_BATCH_SIZE default — override per-call
// if a specific screen's grid shows a different number of visible tiles.
const DEFAULT_FIRST_BATCH_SIZE = 20;

export const channelApi = {
  /**
   * Loads all channels, streaming them in over WebSocket so the UI can render
   * progressively instead of blocking on one giant HTTP response. The first
   * batch is small (sized to roughly one screenful) so first paint is near
   * instant; every batch after that is normal-sized background prefetch.
   *
   * @param onProgress optional callback fired after every batch — pass this
   *   from ChannelContext/useChannels to paint channels as they arrive rather
   *   than waiting for the whole list.
   * @param signal optional AbortSignal to cancel the sync (closes the socket).
   * @param firstBatchSize override the ~one-screenful first batch size.
   */
  async getAllChannels(
    onProgress?: (channels: Channel[], receivedCount: number, total: number) => void,
    signal?: AbortSignal,
    firstBatchSize: number = DEFAULT_FIRST_BATCH_SIZE
  ): Promise<Channel[]> {
    try {
      const all: Channel[] = [];
      await syncChannelsOverSocket(
        { firstBatchSize },
        {
          onBatch: (data, sentCount, total) => {
            const normalized = normalizeBatch(data, all.length);
            all.push(...normalized);
            onProgress?.(all, sentCount, total);
          },
        },
        signal
      );
      console.log(`[channelApi] Loaded ${all.length} channels via WebSocket`);
      return all;
    } catch (err) {
      if (signal?.aborted) throw err; // intentional cancel (refetch/unmount) — don't fall back, just propagate

      console.warn(
        '[channelApi] WebSocket sync failed, falling back to HTTP pagination:',
        (err as Error).message
      );
      const docs = await apiClient.findAll();
      const channels = normalizeBatch(docs as RawChannelDocument[], 0);
      onProgress?.(channels, channels.length, channels.length);
      return channels;
    }
  },
};