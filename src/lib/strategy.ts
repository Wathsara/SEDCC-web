import strategy from '@config/strategy.json';
import { filled } from './site';

/*
  The club's Strategic Development Plan 2025–2030, as published. The wording is
  the committee's; this file only reads it.

  The plan's financial section is deliberately absent from config/strategy.json
  — income strategies, expenditure and financial controls are committee
  business, not visitor content.
*/

export interface Objective {
  name: string;
  detail: string;
}

export interface StrategySection {
  title: string;
  icon: 'bat' | 'ball' | 'stumps' | 'trophy' | 'cap' | 'boundary';
  note: string | null;
  items: Objective[];
}

export const strategyTitle = filled(strategy.title) ?? 'Strategic plan';
export const strategyPeriod = filled(strategy.period);
export const strategySummary = filled(strategy.summary);

export const strategySections = (strategy.sections as StrategySection[]).filter(
  (s) => filled(s.title) && s.items.length > 0,
);

/** The three the club leads with on the home page. */
export const strategyHighlights = strategySections
  .filter((s) => /senior|junior|women/i.test(s.title))
  .map((s) => ({ ...s, lead: s.items[0] }));
