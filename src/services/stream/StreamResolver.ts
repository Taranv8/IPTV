// services/stream/StreamResolver.ts
import axios from 'axios';

export class StreamResolver {
  /**
   * Resolves a stream URL — handles redirects, PHP wrappers, and direct streams.
   */
  static async resolve(url: string): Promise<string> {
    try {
      if (this.isDirectStream(url)) {
        // No need to resolve, return as-is
        return url;
      }

      // Follow redirects to get the final playable URL
      const response = await axios.get(url, {
        maxRedirects: 10,
        timeout: 10000,
        headers: {
          'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
          'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, */*',
        },
        responseType: 'text',
        validateStatus: (status) => status < 400,
      });

      // Case 1: The response body itself is a URL (some PHP endpoints return raw URL)
      const body = typeof response.data === 'string' ? response.data.trim() : '';
      if (body.startsWith('http') && !body.includes('\n')) {
        return body;
      }

      // Case 2: The response body is an M3U/M3U8 playlist — extract first stream URL
      if (body.startsWith('#EXTM3U') || body.includes('#EXTINF')) {
        const extracted = this.extractFirstUrlFromM3U(body);
        if (extracted) return extracted;
      }

      // Case 3: axios followed a redirect — use the final resolved URL
      const finalUrl: string =
        (response.request as any)?.responseURL ||
        (response.config as any)?.url ||
        url;

      return finalUrl;
    } catch (error) {
      // Fallback: let the player attempt the original URL directly
      console.warn('[StreamResolver] Could not resolve URL, falling back to original:', url);
      return url;
    }
  }

  /**
   * Checks whether a URL is already a direct playable stream.
   */
  static isDirectStream(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes('.m3u8') ||
      lower.includes('.ts') ||
      lower.includes('.mp4') ||
      lower.includes('.mkv') ||
      lower.includes('.avi') ||
      lower.startsWith('rtmp://') ||
      lower.startsWith('rtsp://')
    );
  }

  /**
   * Extracts the first stream URL from a raw M3U/M3U8 string.
   */
  private static extractFirstUrlFromM3U(content: string): string | null {
    const lines = content.split('\n').map((l) => l.trim());
    for (const line of lines) {
      if (line.startsWith('http') || line.startsWith('rtmp') || line.startsWith('rtsp')) {
        return line;
      }
    }
    return null;
  }
}