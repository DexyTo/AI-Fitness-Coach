export interface RankedParticipant {
  id: string; nickname: string; avatar: string; level: number; points: number; rank: number; isDemo: boolean;
}
export interface Leaderboard {
  period: 'week' | 'all'; mode: 'regular' | 'demo';
  startsAt: string | null; endsAt: string | null; timeZone: string;
  total: number; offset: number; limit: number; rows: RankedParticipant[]; me: RankedParticipant | null;
}
export interface PublicParticipant {
  id: string; nickname: string; avatar: string; level: number; isDemo: boolean; points: number;
  achievements: { id: string; title: string; earnedAt: string }[];
  results: { kind: 'challenge' | 'duel'; title: string; outcome: string; points: number; eventAt: string }[];
}
