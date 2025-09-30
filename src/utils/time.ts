const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

const pacificIsoFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});

const pacificOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TIME_ZONE,
  timeZoneName: 'shortOffset',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function formatPacificOffset(date: Date): string {
  const parts = pacificOffsetFormatter.formatToParts(date);
  const raw = parts.find(part => part.type === 'timeZoneName')?.value ?? 'GMT-00:00';
  const match = raw.match(/GMT(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?/);
  if (match?.groups) {
    const sign = match.groups.sign;
    const hours = match.groups.hours.padStart(2, '0');
    const minutes = (match.groups.minutes ?? '00').padStart(2, '0');
    return `${sign}${hours}:${minutes}`;
  }
  return '+00:00';
}

function formatPacificIso(date: Date): string {
  const parts = pacificIsoFormatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPart['type']): string =>
    parts.find(part => part.type === type)?.value ?? '';

  const year = lookup('year');
  const month = lookup('month');
  const day = lookup('day');
  const hour = lookup('hour');
  const minute = lookup('minute');
  const second = lookup('second');
  const fractional = lookup('fractionalSecond') || '000';

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${fractional}${formatPacificOffset(date)}`;
}

function parseDateInput(value: Date | string | number): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid date input');
    return new Date(value.getTime());
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid date input');
    return new Date(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) throw new Error('Invalid date input');
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) throw new Error('Invalid date input');
    return new Date(parsed);
  }
  throw new Error('Unsupported date input');
}

export function toPacificIso(value: Date | string | number): string {
  return formatPacificIso(parseDateInput(value));
}

export function ensurePacificIso(value?: Date | string | number | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return toPacificIso(value);
  } catch {
    return undefined;
  }
}

export function pacificNowIso(): string {
  return toPacificIso(new Date());
}

export function toPacificDate(value: Date | string | number): string {
  return toPacificIso(value).slice(0, 10);
}

export function ensurePacificDate(value?: Date | string | number | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return toPacificDate(value);
  } catch {
    return undefined;
  }
}

export { PACIFIC_TIME_ZONE };
