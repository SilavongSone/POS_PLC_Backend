import { localDateParts, localToday, startOfLocalDay } from './time.js';

describe('time helpers (Asia/Vientiane, UTC+7)', () => {
  it('uses the local date after 17:00 UTC', () => {
    expect(localDateParts(new Date('2026-10-26T16:59:00Z')).day).toBe('26');
    expect(localDateParts(new Date('2026-10-26T17:00:00Z')).day).toBe('27');
  });

  it('finds the UTC instant of local midnight', () => {
    expect(startOfLocalDay('2026-10-26').toISOString()).toBe(
      '2026-10-25T17:00:00.000Z',
    );
  });

  it('formats today as YYYY-MM-DD', () => {
    expect(localToday(new Date('2026-12-31T18:00:00Z'))).toBe('2027-01-01');
  });
});
