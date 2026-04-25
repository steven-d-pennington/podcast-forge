const MINUTES_PER_YEAR = 366 * 24 * 60;

interface CronField {
  min: number;
  max: number;
  wildcard: boolean;
  values: Set<number>;
}

function parseCronField(raw: string, min: number, max: number, name: string): CronField {
  const values = new Set<number>();
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);

  if (parts.length === 0) {
    throw new Error(`Invalid cron ${name} field.`);
  }

  for (const part of parts) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);

    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid cron ${name} step.`);
    }

    let start: number;
    let end: number;

    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [startRaw, endRaw] = rangePart.split('-');
      start = Number(startRaw);
      end = Number(endRaw);
    } else {
      start = Number(rangePart);
      end = Number(rangePart);
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`Invalid cron ${name} range.`);
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return { min, max, wildcard: values.size === max - min + 1, values };
}

function parseCron(cron: string) {
  const fields = cron.trim().split(/\s+/);

  if (fields.length !== 5) {
    throw new Error('Cron schedule must have five fields: minute hour day-of-month month day-of-week.');
  }

  return {
    minute: parseCronField(fields[0], 0, 59, 'minute'),
    hour: parseCronField(fields[1], 0, 23, 'hour'),
    dayOfMonth: parseCronField(fields[2], 1, 31, 'day-of-month'),
    month: parseCronField(fields[3], 1, 12, 'month'),
    dayOfWeek: parseCronField(fields[4], 0, 7, 'day-of-week'),
  };
}

function cronDayOfWeek(date: Date) {
  const day = date.getUTCDay();
  return day === 0 ? [0, 7] : [day];
}

function matches(field: CronField, value: number) {
  return field.values.has(value);
}

export function assertValidCron(cron: string) {
  parseCron(cron);
}

export function nextCronRun(cron: string, after = new Date()): Date {
  const parsed = parseCron(cron);
  const cursor = new Date(after);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let i = 0; i < MINUTES_PER_YEAR; i += 1) {
    const dayOfMonthMatches = matches(parsed.dayOfMonth, cursor.getUTCDate());
    const dayOfWeekMatches = cronDayOfWeek(cursor).some((value) => matches(parsed.dayOfWeek, value));
    const dayMatches = parsed.dayOfMonth.wildcard || parsed.dayOfWeek.wildcard
      ? dayOfMonthMatches && dayOfWeekMatches
      : dayOfMonthMatches || dayOfWeekMatches;

    if (
      matches(parsed.minute, cursor.getUTCMinutes())
      && matches(parsed.hour, cursor.getUTCHours())
      && dayMatches
      && matches(parsed.month, cursor.getUTCMonth() + 1)
    ) {
      return new Date(cursor);
    }

    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error('Cron schedule has no matching run within one year.');
}
