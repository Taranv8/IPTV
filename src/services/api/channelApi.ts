import { apiClient } from './apiClient';
import { RawChannelDocument, Channel, normalizeChannel } from '../../types/channel';

export const channelApi = {
  async getAllChannels(): Promise<Channel[]> {
    const docs = await apiClient.findAll();
    return (docs as RawChannelDocument[]).map((doc, index) => normalizeChannel(doc, index));
  },
};