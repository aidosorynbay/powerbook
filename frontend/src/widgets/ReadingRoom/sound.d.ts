export const Ding: { prime(): void; play(): void };

export type SoundChannel = 'music' | 'fire' | 'rain' | 'pages';

export const Snd: {
  enabled: boolean;
  enable(): void;
  disable(): void;
  set(channel: SoundChannel, on: boolean): void;
  vol(channel: SoundChannel, v: number): void;
  page(v?: number): void;
};
