// Class names and small input helpers shared by the CRM screens (kept out of
// the component files so fast refresh keeps working).
export const btn = {
  primary: 'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-green-700 text-white text-sm font-bold active:scale-[0.99] disabled:opacity-50',
  dark: 'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-gray-900 text-white text-sm font-bold disabled:opacity-50',
  ghost: 'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-gray-200 bg-white text-gray-900 text-sm font-bold disabled:opacity-50',
  small: 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-gray-900 text-[13px] font-bold disabled:opacity-50',
  smallGreen: 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-green-700 text-white text-[13px] font-bold disabled:opacity-50',
};
export const input = 'w-full h-11 rounded-xl border border-gray-200 bg-white px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-green-600/30';
export const card = 'bg-white border border-gray-200 rounded-2xl';

/** 'YYYY-MM-DDTHH:MM' for a datetime-local input, in the browser's own time. */
export function toLocalInput(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
/** A datetime-local value (browser time) as an ISO instant, or null. */
export function toInstantLocal(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** The menu for each role: [path, label, icon]. The phone shows the first five. */
export const MENUS = {
  manager: [['', 'Today', 'home'], ['leads', 'Leads', 'leads'], ['followups', 'Follow-ups', 'calendar'], ['assign', 'Assign', 'assign'],
    ['queue', 'Call queue', 'phone'], ['checkin', 'Check in', 'pin'], ['attendance', 'Attendance', 'clock'], ['team', 'Team', 'team']],
  caller: [['', 'Today', 'home'], ['queue', 'Call queue', 'phone'], ['leads', 'My leads', 'leads'], ['followups', 'Follow-ups', 'calendar'], ['attendance', 'Attendance', 'clock']],
  field: [['', 'Today', 'home'], ['checkin', 'Check in', 'pin'], ['leads', 'My leads', 'leads'], ['followups', 'Follow-ups', 'calendar'], ['attendance', 'Attendance', 'clock']],
};
