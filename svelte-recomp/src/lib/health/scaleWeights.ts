// Weigh-ins from a smart scale, through Health Connect (Withings, Renpho,
// Eufy, Xiaomi, Garmin, Fitbit and the rest write their readings there).
// One a day, the earliest (the morning one), in kg; never Moderly's own
// records (it writes typed weigh-ins back to Health Connect, and reading them
// again would loop); only plausible weights. The caller keeps a day already
// logged in Moderly. Pure; see selfcheck.js.

const TO_KG: Record<string, number> = { kilogram: 1, gram: 0.001, pound: 0.45359237, ounce: 0.028349523125, milligram: 1e-6, microgram: 1e-9 };

export interface ScaleDay { date: string; kg: number; at: string; origin: string }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function scaleDays(records: any[], ownPackage: string): ScaleDay[] {
  const byDay = new Map<string, ScaleDay>();
  for (const r of records ?? []) {
    const origin = String(r?.metadata?.dataOrigin ?? '');
    if (!origin || origin === ownPackage) continue;
    const unit = String(r?.weight?.unit ?? '');
    const kg = Math.round(Number(r?.weight?.value) * (TO_KG[unit] ?? NaN) * 100) / 100;
    const t = new Date(r?.time);
    if (!(kg >= 25 && kg <= 350) || Number.isNaN(t.getTime())) continue;
    const day = { date: ymd(t), kg, at: t.toISOString(), origin };
    const prev = byDay.get(day.date);
    if (!prev || day.at < prev.at) byDay.set(day.date, day);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}
