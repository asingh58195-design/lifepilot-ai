import type { ScheduleItem } from '../types';
import { diffDays, startOfDay, ymd } from './time';

const RANK: Record<ScheduleItem['kind'], number> = { reminder: 0, preparation: 1, task: 2, action: 3, work: 4, appointment: 5 };

export function sortItems(items: ScheduleItem[]): ScheduleItem[] {
  return [...items].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() || RANK[a.kind] - RANK[b.kind]);
}

export interface DayGroup {
  key: string;
  date: Date;
  items: ScheduleItem[];
}

export function groupByDay(items: ScheduleItem[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const s of sortItems(items)) {
    const d = startOfDay(new Date(s.start));
    const key = ymd(d);
    const g = groups.get(key) ?? { key, date: d, items: [] };
    g.items.push(s);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function itemsOnDay(items: ScheduleItem[], day: Date): ScheduleItem[] {
  return sortItems(items.filter((s) => diffDays(new Date(s.start), day) === 0));
}
