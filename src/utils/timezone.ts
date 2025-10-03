export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function formatIsoDateInTimeZone(date: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });

    const parts = formatter.formatToParts(date);
    const partMap = new Map<Intl.DateTimeFormatPartTypes, string>();
    for (const part of parts) {
      if (part.type === 'literal') continue;
      if (!partMap.has(part.type)) {
        partMap.set(part.type, part.value);
      }
    }

    const year = partMap.get('year');
    const month = partMap.get('month');
    const day = partMap.get('day');
    const hour = partMap.get('hour');
    const minute = partMap.get('minute');
    const second = partMap.get('second');
    const fractional = partMap.get('fractionalSecond') ?? '000';

    if (!year || !month || !day || !hour || !minute || !second) {
      return date.toISOString();
    }

    const fractionalPadded = fractional.length >= 3
      ? fractional.slice(0, 3)
      : `${fractional}${'0'.repeat(3 - fractional.length)}`;

    const base = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fractionalPadded}`;

    const offsetFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      timeZoneName: 'longOffset',
    });
    const offsetParts = offsetFormatter.formatToParts(date);
    const rawOffset = offsetParts.find(part => part.type === 'timeZoneName')?.value ?? 'UTC';
    let offset = rawOffset.replace(/^GMT/, '').replace(/^UTC/, '');
    offset = offset.replace(/\u2212/g, '-');

    if (!offset || offset === '+00:00' || offset === '-00:00' || offset === '+0000' || offset === '-0000') {
      return `${base}Z`;
    }

    if (!offset.includes(':') && /^[-+]\d{2}$/.test(offset)) {
      offset = `${offset}:00`;
    } else if (!offset.includes(':') && /^[-+]\d{4}$/.test(offset)) {
      offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
    }

    return `${base}${offset}`;
  } catch {
    return date.toISOString();
  }
}
