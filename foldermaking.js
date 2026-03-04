
// IPTV React Native App - Folder Structure Setup Script (Node.js)
// Run: node setup.js

const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up IPTV App folder structure...\n');

// Function to create directory if it doesn't exist
function createDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Function to create empty file
function createFile(filePath) {
  const dir = path.dirname(filePath);
  createDir(dir);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '');
  }
}

// Define folder structure
const directories = [
  'src/components/common',
  'src/components/player',
  'src/components/channel',
  'src/components/ui',
  'src/screens/splash',
  'src/screens/selection',
  'src/screens/simple',
  'src/screens/advanced',
  'src/screens/settings',
  'src/navigation',
  'src/services/m3u',
  'src/services/api',
  'src/services/error',
  'src/services/storage',
  'src/utils',
  'src/constants',
  'src/assets/images',
  'src/assets/fonts',
  'src/assets/animations',
  'src/hooks',
  'src/context',
  'src/types'
];

// Define files to create
const files = [
  // Common Components
  'src/components/common/Button.tsx',
  'src/components/common/Loading.tsx',
  'src/components/common/ErrorBoundary.tsx',
  'src/components/common/Modal.tsx',
  'src/components/common/Input.tsx',

  // Player Components
  'src/components/player/VideoPlayer.tsx',
  'src/components/player/PlayerControls.tsx',
  'src/components/player/PlayerOverlay.tsx',

  // Channel Components
  'src/components/channel/ChannelList.tsx',
  'src/components/channel/ChannelItem.tsx',
  'src/components/channel/ChannelGrid.tsx',
  'src/components/channel/ChannelCard.tsx',
  'src/components/channel/ChannelFilters.tsx',
  'src/components/channel/Keypad.tsx',
  'src/components/channel/CategorySelector.tsx',
  'src/components/channel/LanguageSelector.tsx',

  // UI Components
  'src/components/ui/Header.tsx',
  'src/components/ui/Navigation.tsx',
  'src/components/ui/StatusBar.tsx',

  // Screens
  'src/screens/splash/SplashScreen.tsx',
  'src/screens/selection/SelectionScreen.tsx',
  'src/screens/simple/SimpleUIScreen.tsx',
  'src/screens/advanced/AdvancedUIScreen.tsx',
  'src/screens/settings/SettingsScreen.tsx',

  // M3U Service
  'src/services/m3u/M3UParser.ts',
  'src/services/m3u/M3UFetcher.ts',
  'src/services/m3u/M3UValidator.ts',

  // API Service
  'src/services/api/apiClient.ts',
  'src/services/api/channelApi.ts',

  // Error Service
  'src/services/error/ErrorLogger.ts',
  'src/services/error/ErrorReporter.ts',
  'src/services/error/CrashHandler.ts',

  // Storage Service
  'src/services/storage/AsyncStorageService.ts',
  'src/services/storage/CacheService.ts',
  'src/services/storage/PreferencesService.ts',

  // Utils
  'src/utils/channelUtils.ts',
  'src/utils/formatters.ts',
  'src/utils/validators.ts',
  'src/utils/helpers.ts',

  // Constants
  'src/constants/colors.ts',
  'src/constants/channels.ts',
  'src/constants/config.ts',
  'src/constants/routes.ts',

  // Hooks
  'src/hooks/useChannels.ts',
  'src/hooks/usePlayer.ts',
  'src/hooks/useM3U.ts',
  'src/hooks/useOrientation.ts',
  'src/hooks/useSettings.ts',

  // Context
  'src/context/ChannelContext.tsx',
  'src/context/PlayerContext.tsx',
  'src/context/SettingsContext.tsx',
  'src/context/ThemeContext.tsx',

  // Types
  'src/types/channel.ts',
  'src/types/player.ts',
  'src/types/navigation.ts',
  'src/types/m3u.ts',

  // Navigation
  'src/navigation/AppNavigator.tsx',
  'src/navigation/RootNavigator.tsx'
];

// Create directories
console.log('📁 Creating directories...');
directories.forEach(dir => {
  createDir(dir);
});

// Create files
console.log('📝 Creating files...');
files.forEach(file => {
  createFile(file);
});

console.log('\n✅ Folder structure created successfully!\n');

// Print project structure
console.log('📊 Project Structure:');
console.log('src/');
console.log('├── assets/');
console.log('│   ├── animations/');
console.log('│   ├── fonts/');
console.log('│   └── images/');
console.log('├── components/');
console.log('│   ├── channel/');
console.log('│   ├── common/');
console.log('│   ├── player/');
console.log('│   └── ui/');
console.log('├── constants/');
console.log('├── context/');
console.log('├── hooks/');
console.log('├── navigation/');
console.log('├── screens/');
console.log('│   ├── advanced/');
console.log('│   ├── selection/');
console.log('│   ├── settings/');
console.log('│   ├── simple/');
console.log('│   └── splash/');
console.log('├── services/');
console.log('│   ├── api/');
console.log('│   ├── error/');
console.log('│   ├── m3u/');
console.log('│   └── storage/');
console.log('├── types/');
console.log('└── utils/');

console.log('\n🎉 Setup complete! You can now start developing your IPTV app.\n');
console.log('Next steps:');
console.log('1. Install required dependencies (see package.json template)');
console.log('2. Configure your M3U URL in src/constants/config.ts');
console.log('3. Implement the M3U parser in src/services/m3u/');
console.log('4. Set up error reporting in src/services/error/');
console.log('5. Start building your screens!');

// Create a baaaaasic package.json snippet for dependencies
const packageJsonSnippet = {
  dependencies: {
    "react": "18.2.0",
    "react-native": "0.72.0",
    "@react-navigation/native": "^6.1.9",
    "@react-navigation/stack": "^6.3.20",
    "react-native-video": "^5.2.1",
    "react-native-orientation-locker": "^1.5.0",
    "@react-native-async-storage/async-storage": "^1.19.5",
    "axios": "^1.6.2",
    "react-native-gesture-handler": "^2.14.0",
    "react-native-reanimated": "^3.6.0",
    "react-native-safe-area-context": "^4.7.4",
    "react-native-screens": "^3.27.0"
  },
  devDependencies: {
    "@types/react": "^18.2.0",
    "@types/react-native": "^0.72.0",
    "typescript": "^5.0.0"
  }
};

console.log('\n📦 Save this to install dependencies later:');
console.log('Run: npm install ' + Object.keys(packageJsonSnippet.dependencies).join(' '));
console.log('\n✨ All done!');