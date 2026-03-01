// services/error/ErrorReporter.ts
import axios from 'axios';
import { ERROR_REPORTING } from '../../constants/config';
import DeviceInfo from 'react-native-device-info';

interface ErrorReport {
  timestamp: string;
  appVersion: string;
  platform: string;
  osVersion: string;
  deviceModel: string;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  additionalInfo?: any;
}

export class ErrorReporter {
  static async report(error: Error, errorType: string, additionalInfo?: any): Promise<void> {
    // ✅ Guard against ERROR_REPORTING being undefined (e.g. missing from config)
    if (!ERROR_REPORTING?.ENABLED) return;

    try {
      const errorReport: ErrorReport = {
        timestamp: new Date().toISOString(),
        appVersion: await DeviceInfo.getVersion(),
        platform: DeviceInfo.getSystemName(),
        osVersion: DeviceInfo.getSystemVersion(),
        deviceModel: await DeviceInfo.getModel(),
        errorType,
        errorMessage: error.message,
        stackTrace: error.stack,
        additionalInfo,
      };

      await axios.post(ERROR_REPORTING.API_ENDPOINT, errorReport, {
        timeout: ERROR_REPORTING.TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (err) {
      // Never let error reporting crash the app
      console.warn('[ErrorReporter] Failed to send report:', err);
    }
  }
}