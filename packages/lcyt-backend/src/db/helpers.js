/**
 * Get the current UTC date string and hour.
 * @returns {{ date: string, hour: number }}
 */
export function currentDateHour() {
  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    hour: now.getUTCHours(),
  };
}
