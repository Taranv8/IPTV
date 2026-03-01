import { Channel } from '../../types/channel';

export class M3UParser {
  static parse(m3uContent: string): Channel[] {
    const lines = m3uContent.split('\n').filter(line => line.trim());
    const channels: Channel[] = [];
    let currentChannel: Partial<Channel> = {};
    let channelNumber = 100;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        // Parse EXTINF line
        const attributes = this.parseExtInf(line);
        currentChannel = {
          id: `ch_${channelNumber}`,
          number: channelNumber++,
          name: attributes.name || `Channel ${channelNumber}`,
          category: attributes.groupTitle || 'Entertainment',
          language: attributes.language || 'English',
          logo: attributes.logo,
          isHD: attributes.name?.includes('HD') || false,
          isFavorite: false,
        };
      } else if (line.startsWith('http')) {
        // This is the stream URL
        if (currentChannel.name) {
currentChannel.url = line.trim().replace(/[\r\n\t ]+$/, '');
          channels.push(currentChannel as Channel);
          currentChannel = {};
        }
      }
    }

    return channels;
  }

  private static parseExtInf(line: string): any {
    const attributes: any = {};
    
    // Extract tvg-logo
    const logoMatch = line.match(/tvg-logo="([^"]*)"/);
    if (logoMatch) attributes.logo = logoMatch[1];
    
    // Extract group-title
    const groupMatch = line.match(/group-title="([^"]*)"/);
    if (groupMatch) attributes.groupTitle = groupMatch[1];
    
    // Extract tvg-id
    const idMatch = line.match(/tvg-id="([^"]*)"/);
    if (idMatch) attributes.id = idMatch[1];
    
    // Extract tvg-language
    const langMatch = line.match(/tvg-language="([^"]*)"/);
    if (langMatch) attributes.language = langMatch[1];
    
    // Extract channel name (after the last comma)
    const nameMatch = line.match(/,(.+)$/);
    if (nameMatch) attributes.name = nameMatch[1].trim();
    
    return attributes;
  }
}