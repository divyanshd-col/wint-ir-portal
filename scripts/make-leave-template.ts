// Writes the go-live Excel template: npx tsx scripts/make-leave-template.ts [output.xlsx]
import * as XLSX from 'xlsx';

const out = process.argv[2] || 'leave-go-live-template.xlsx';
const wb = XLSX.utils.book_new();
const sheet = (rows: (string | number)[][], widths: number[]) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map(w => ({ wch: w })); return ws; };

XLSX.utils.book_append_sheet(wb, sheet([
  ['How to fill this in'],
  [''],
  ['1. Balances: one row per person with their balance today, in quarter days (like 3.25). It can be negative, even below -2.'],
  ['   The balance must already have future approved leave taken off, exactly as your current records show it.'],
  ['2. Leaves: every leave and LOP since 1 January, plus all future approved leave. One row per request.'],
  ['   Status is Approved (not started yet or still running) or Taken (finished). Dates are YYYY-MM-DD.'],
  ['   A block can start on the second half of its first day (Start half = second) and end on the first half of its last day (End half = first).'],
  ['   A single half day: same date in both columns, and the same half (first or second) in both half columns.'],
  ['   Leave ID is optional. Leave it empty and the system gives each one a new ID (LV-10001, ...).'],
  ['   Week-offs inside a block are worked out from each person\'s roster, so do not list them.'],
  ['3. Holidays: the list of public holidays, one per row.'],
  ['People are matched by work email. Everyone must already be a person in the portal and have a roster type loaded.'],
  ['Past items are history only and do not change anyone\'s balance. Load this once.'],
], [140]), 'Read me');

XLSX.utils.book_append_sheet(wb, sheet([
  ['Email', 'Balance'],
  ['priya.sharma@wintwealth.com', 3.25],
  ['rohan.das@wintwealth.com', -2.75],
], [36, 12]), 'Balances');

XLSX.utils.book_append_sheet(wb, sheet([
  ['Email', 'Leave ID', 'Type', 'Status', 'Start date', 'Start half', 'End date', 'End half', 'Reason'],
  ['priya.sharma@wintwealth.com', 'LV-10452', 'leave', 'Approved', '2026-11-26', 'full', '2026-11-27', 'full', 'Family function'],
  ['priya.sharma@wintwealth.com', '', 'leave', 'Taken', '2026-11-03', 'second', '2026-11-04', 'first', 'Medical'],
  ['rohan.das@wintwealth.com', '', 'lop', 'Approved', '2026-12-02', 'second', '2026-12-02', 'second', 'Personal work'],
], [30, 12, 8, 10, 12, 11, 12, 10, 28]), 'Leaves');

XLSX.utils.book_append_sheet(wb, sheet([
  ['Date', 'Name'],
  ['2026-12-25', 'Christmas'],
  ['2027-01-26', 'Republic Day'],
], [14, 30]), 'Holidays');

XLSX.writeFile(wb, out);
console.log(`Wrote ${out}`);
