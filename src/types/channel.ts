export interface Channel {
  id: string;
  number: number;
  name: string;
  url: string;
  logo?: string;
  category: string;
  language: string;
  isHD: boolean;
  isFavorite: boolean;
  group?: string;
}

export interface ChannelFilter {
  category: string;
  language: string;
  search?: string;
}