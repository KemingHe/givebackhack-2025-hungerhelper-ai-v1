export enum Role {
  USER = 'user',
  MODEL = 'model',
}

export interface GroundingSource {
  uri: string;
  title: string;
  type: 'web' | 'maps';
}

export interface Message {
  id: string;
  text: string;
  role: Role;
  sources?: GroundingSource[];
  audioData?: string;
  isPlayingAudio?: boolean;
  isThinking?: boolean;
  thinkingSteps?: string[];
  isGeneratingAudio?: boolean;
}

export interface Pantry {
  Name: string;
  Location: string;
  Hours: string;
  "Phone Number": string;
  "Additional Notes": string;
}