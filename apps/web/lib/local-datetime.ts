/**
 * `datetime-local` inputs contain a local wall-clock value with no zone. Campaign schedules are stored as ISO UTC.
 * Convert in both directions so a merchant sees the time they typed after a save and a reload.
 */
export function toLocalDateTimeInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromLocalDateTimeInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
