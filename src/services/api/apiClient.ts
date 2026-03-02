import { APP_CONFIG } from '../../constants/config';

export const apiClient = {
  async findAll(): Promise<any[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), APP_CONFIG.REQUEST_TIMEOUT);

    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/channels`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      return json.data ?? [];
    } finally {
      clearTimeout(timeout);
    }
  },
};