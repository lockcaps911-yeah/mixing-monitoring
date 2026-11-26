import { EventEmitter } from 'node:events';

// Event bus in-memory. Cukup untuk 1 proses Node (next start / pm2 1 instance).
// Jika nanti multi-instance, ganti dengan Postgres LISTEN/NOTIFY atau Redis pub/sub.
const g = globalThis as unknown as { bus?: EventEmitter };

export const bus = g.bus ?? new EventEmitter();
bus.setMaxListeners(200);
g.bus = bus;

export type RealtimeMessage = {
  line: string;
  machine: string;
  ts: string;
  values: Record<string, number>;   // tag -> nilai
  quality: Record<string, 'GOOD' | 'BAD'>;
  timestamps: Record<string, string>;
  valves: Record<string, boolean>;  // tag -> on/off
};
