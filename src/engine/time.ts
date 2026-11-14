/** Integer game time helpers. `tick` = game minutes since campaign start (day 1, 06:00 UTC). */
import { CAMPAIGN_DAYS, DAY_MIN, START_DATE, START_MINUTE_OF_DAY, STEP_MIN } from './rules';

/** Minutes since day 1 00:00. */
export function absMinute(tick: number): number {
  return tick + START_MINUTE_OF_DAY;
}
/** 1-based campaign day. */
export function dayOf(tick: number): number {
  return Math.floor(absMinute(tick) / DAY_MIN) + 1;
}
export function minuteOfDay(tick: number): number {
  return absMinute(tick) % DAY_MIN;
}
export function hourOfDay(tick: number): number {
  return Math.floor(minuteOfDay(tick) / 60);
}
export function isDayChange(tick: number): boolean {
  return tick > 0 && absMinute(tick) % DAY_MIN === 0;
}
export function isHour(tick: number): boolean {
  return absMinute(tick) % 60 === 0;
}
/** Tick of the settlement at the end of game day `day` (00:00 of day+1). */
export function dayEndTick(day: number): number {
  return day * DAY_MIN - START_MINUTE_OF_DAY;
}
export const FINAL_TICK = dayEndTick(CAMPAIGN_DAYS);
export function nextStepTick(tick: number): number {
  return Math.floor(tick / STEP_MIN) * STEP_MIN + STEP_MIN;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Fictional calendar label "YYYY-MM-DD HH:MM" (UTC). */
export function formatGameTime(tick: number, startDate = START_DATE): string {
  const [y0, m0, d0] = startDate.split('-').map(Number);
  let y = y0, m = m0, d = d0 + (dayOf(tick) - 1);
  for (;;) {
    const md = m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : MONTH_DAYS[m - 1];
    if (d <= md) break;
    d -= md;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  const mod = minuteOfDay(tick);
  const hh = String(Math.floor(mod / 60)).padStart(2, '0');
  const mm = String(mod % 60).padStart(2, '0');
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${hh}:${mm}`;
}
export function formatDuration(min: number): string {
  const d = Math.floor(min / DAY_MIN);
  const h = Math.floor((min % DAY_MIN) / 60);
  const m = min % 60;
  return [d ? `${d}d` : '', h ? `${h}h` : '', m || (!d && !h) ? `${m}m` : ''].filter(Boolean).join(' ');
}
