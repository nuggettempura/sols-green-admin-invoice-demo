export interface DayReading {
  date: string;
  energy: number;
  energy_custom: number | null;
  flags: string[];
}

// Eligible plant IDs — all days produce energy
const ELIGIBLE_PLANT_IDS = new Set(["1001", "1002", "1003", "1006", "1007", "1008"]);

// Energy seed per plant (kWh base, varied deterministically)
const PLANT_ENERGY_SEED: Record<string, number> = {
  "1001": 12.4,
  "1002": 10.8,
  "1003": 11.2,
  "1004": 9.6,
  "1005": 13.0,
  "1006": 10.2,
  "1007": 11.8,
  "1008": 12.0,
};

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

// Deterministic pseudo-random variation: day-of-month gives ±2 kWh swing
function dailyVariation(date: string, seed: number): number {
  const day = parseInt(date.slice(8, 10), 10);
  const variation = Math.sin(day * seed) * 2;
  return Math.max(0.5, seed + variation);
}

// Returns true if this day should be an "error" (missing data) day
function isErrorDay(plantId: string, date: string): boolean {
  const day = parseInt(date.slice(8, 10), 10);
  if (plantId === "1004") return day % 7 === 0;   // every 7th day of month
  if (plantId === "1005") return day % 5 === 0;   // every 5th day of month
  return false;
}

export function getDailyReadings(
  plantId: string,
  startDate: string,
  endDate: string
): DayReading[] {
  const dates = datesBetween(startDate, endDate);
  const seed = PLANT_ENERGY_SEED[plantId] ?? 10.0;

  return dates.map((date) => {
    if (isErrorDay(plantId, date)) {
      return { date, energy: 0, energy_custom: null, flags: [] };
    }
    const energy = parseFloat(dailyVariation(date, seed).toFixed(2));
    return { date, energy, energy_custom: null, flags: [] };
  });
}

export function getMissingDates(
  plantId: string,
  startDate: string,
  endDate: string
): string[] {
  return getDailyReadings(plantId, startDate, endDate)
    .filter((r) => r.energy === 0 && r.energy_custom === null && r.flags.length === 0)
    .map((r) => r.date);
}

export function isSubscriberEligible(
  plantId: string,
  startDate: string,
  endDate: string
): boolean {
  return getMissingDates(plantId, startDate, endDate).length === 0;
}
