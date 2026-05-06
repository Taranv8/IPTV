import { apiClient } from './apiClient';
import { RawChannelDocument, Channel, normalizeChannel } from '../../types/channel';

export const channelApi = {
  async getAllChannels(): Promise<Channel[]> {
    const docs     = await apiClient.findAll();
    const channels: Channel[] = [];

    (docs as RawChannelDocument[]).forEach((doc, index) => {
      try {
        channels.push(normalizeChannel(doc, index));
      } catch (e) {
        console.warn('[channelApi] Failed to normalize doc at index', index, e);
      }
    });

    return channels;
  },
};