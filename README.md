# 📺 IPTV Player

A feature-rich, cross-platform IPTV streaming application built with **React Native**, designed primarily for **Google TV** and **Android** phones, with planned support for additional TV operating systems.

---

## ✨ Features

### 🎬 Streaming & Playback
- **Bufferless TV channel streaming** with adaptive stream resolution
- **Multiple stream sources per channel** — automatic failover via `StreamResolver`
- **Stream health monitoring** via `StreamHealthService` for real-time quality checks
- **Full-featured video player** with custom overlay controls (`PlayerOverlay`, `PlayerControls`)
- **EPG (Electronic Program Guide)** support via `epgService`

### 📺 Dual UI Layouts
- **Simple UI** — clean, linear channel list for quick browsing (`SimpleUIScreen`)
- **Advanced UI** — rich grid-based channel display with cards and categories (`AdvancedUIScreen`)

### 🔍 Channel Discovery & Navigation
- **Category-based filtering** (`CategorySelector`, `ChannelFilters`)
- **Language selector** for multilingual channel libraries
- **Keypad dialer** for direct channel number entry
- **Search and sort** utilities via `channelUtils`

### 🔒 Security
- **Root detection** — native Kotlin module (`RootDetectionModule`) with JS service layer (`rootDetectionService`)
- **SSL Pinning** — custom `OkHttpClient` factory (`PinnedOkHttpClientFactory`) with full JS bridge (`SslPinningModule`, `SslPinningService`)
- **Certificate pinning** protects all API traffic from MITM attacks

### 🔄 OTA Updates
- **Over-the-air update system** (`OTAUpdateService`, `OTAUpdateScreen`) — push app updates without going through the Play Store
- **Remote config service** (`remoteConfigService`) for dynamic feature flags and configuration

### 📱 Device & Orientation Support
- **Native orientation management** via `OrientationModule` (Kotlin) and `useOrientation` hook
- **Landscape/portrait auto-rotation** with `OrientationHelper`
- Optimized layouts for both **10-foot TV UI** and **handheld phone** use cases

### 🎨 UI & UX
- **Animated splash screen** (`SplashScreen`) with Lottie animation support
- **Theme system** with `ThemeContext` for light/dark mode
- **Custom fonts and image assets**
- **Reusable component library** — `Button`, `Input`, `Modal`, `Loading`, `ErrorBoundary`

### ⚙️ Settings & Personalization
- **Settings screen** with persistent user preferences (`SettingsContext`, `PreferencesService`)
- **Async storage layer** with caching (`CacheService`, `AsyncStorageService`)

### 🛠️ Reliability & Error Handling
- **Crash handler** and structured error logging (`CrashHandler`, `ErrorLogger`, `ErrorReporter`)
- **Video error boundary** to gracefully handle player failures (`VideoErrorBoundary`)
- **Global error boundary** for React tree (`ErrorBoundary`)

---

## 🗂️ Project Structure

```
├── android/                        # Native Android code
│   └── src/main/java/com/iptv/
│       ├── MainActivity.kt
│       ├── MainApplication.kt
│       ├── OrientationModule.kt    # Native screen orientation control
│       ├── RootDetectionModule.kt  # Native root/jailbreak detection
│       └── sslpinning/
│           ├── PinnedOkHttpClientFactory.kt
│           ├── SslPinningModule.kt
│           └── SslPinningPackage.kt
│
└── src/
    ├── assets/                     # Fonts, images, Lottie animations
    ├── components/
    │   ├── channel/                # Channel list, grid, filters, keypad
    │   ├── common/                 # Shared UI primitives
    │   └── player/                 # Video player and controls
    ├── constants/                  # App config, routes, colors, channel data
    ├── context/                    # React contexts (Channel, Player, Settings, Theme)
    ├── hooks/                      # Custom hooks (channels, player, orientation, settings)
    ├── navigation/                 # App & root navigators
    ├── screens/
    │   ├── advanced/               # Grid-based channel UI
    │   ├── simple/                 # List-based channel UI
    │   ├── selection/              # UI mode selection screen
    │   ├── settings/               # App settings
    │   ├── ota/                    # OTA update screen
    │   └── splash/                 # Animated splash screen
    ├── services/
    │   ├── api/                    # API client and channel API
    │   ├── error/                  # Crash handling and logging
    │   ├── storage/                # Async storage, caching, preferences
    │   └── stream/                 # Stream resolution and health monitoring
    ├── types/                      # TypeScript type definitions
    └── utils/                      # Helpers, formatters, validators
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18
- React Native CLI
- Android Studio with Android SDK
- JDK 17+

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/iptv-player.git
cd iptv-player

# Install dependencies
npm install

# Install iOS pods (if applicable)
cd ios && pod install && cd ..
```

### Running the App

```bash
# Android phone
npx react-native run-android

# Google TV (connect ADB to TV device)
adb connect <TV_IP>:5555
npx react-native run-android --deviceId <device-id>
```

### Channel Configuration

Place your M3U8 playlist at:
```
src/constants/channels.m3u8
android/src/main/assets/channels.m3u8
```

---

## 🔐 Security Configuration

### SSL Pinning

Update your certificate hashes in the SSL pinning configuration:

```kotlin
// PinnedOkHttpClientFactory.kt
CertificatePinner.Builder()
    .add("your-api-domain.com", "sha256/YOUR_CERTIFICATE_HASH")
    .build()
```

### Root Detection

Root detection runs automatically on app launch via `rootDetectionService`. Configure the response behavior in `config.ts`.

---

## 📡 Supported Platforms

| Platform | Status |
|---|---|
| Android Phone | ✅ Supported |
| Google TV | ✅ Supported |
| Amazon Fire TV | 🔜 Planned |
| Roku | 🔜 Planned |
| Apple TV (tvOS) | 🔜 Planned |
| Samsung Tizen | 🔜 Planned |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native |
| Language | TypeScript / Kotlin |
| Navigation | React Navigation |
| State Management | React Context API |
| Video Playback | React Native Video |
| Storage | AsyncStorage |
| Animations | Lottie (splash screen) |
| HTTP Security | OkHttp + Certificate Pinning |
| Native Modules | Kotlin (Orientation, Root Detection, SSL Pinning) |

---

## 📋 Environment Configuration

App behavior can be configured via `src/constants/config.ts` and remotely via `remoteConfigService`. Key settings include stream timeout, fallback source order, root detection enforcement, and OTA update endpoints.

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is proprietary. All rights reserved.

---

> Built with ❤️ for cord-cutters everywhere.
