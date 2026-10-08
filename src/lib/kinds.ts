import type { Category, ItemKind, Priority } from '../types';
import type { IconName } from '../components/Icon';

export const KIND_META: Record<ItemKind, { label: string; icon: IconName }> = {
  appointment: { label: 'Appointment', icon: 'calendar' },
  action: { label: 'Action', icon: 'arrow' },
  reminder: { label: 'Reminder', icon: 'bell' },
  preparation: { label: 'Preparation', icon: 'doc' },
  work: { label: 'Work', icon: 'briefcase' },
  task: { label: 'Task', icon: 'check' },
};

export const CATEGORY_ICON: Record<Category, IconName> = {
  Health: 'heart',
  Work: 'briefcase',
  Personal: 'user',
  Errands: 'cart',
  Fitness: 'run',
  Home: 'home',
};

export const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
