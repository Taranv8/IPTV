export const DEFAULT_GROUPS = [
  'All',
  'HINDI',
  'ENGLISH',
  'SPORTS',
  'NEWS',
  'MOVIES',
  'KIDS',
  'MUSIC',
];

export const LANGUAGES = [
  'All',
  'English',
  'Hindi',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
];

// Helper to get unique groups from loaded channels
export const getGroupsFromChannels = (channels: { group?: string }[]): string[] => {
  const groups = new Set(channels.map(ch => ch.group || 'Uncategorized'));
  return ['All', ...Array.from(groups).sort()];
};