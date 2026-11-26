// Class names for PocketLink Admin: the Console's dark cockpit (near-black
// warm green, emerald actions). Kept out of component files so fast refresh
// keeps working.
export const card = 'bg-[#131c17] border border-[#1f2b24] rounded-2xl';
const btnBase = 'inline-flex items-center justify-center gap-2 rounded-xl border text-[13.5px] font-semibold whitespace-nowrap no-underline disabled:opacity-50 disabled:cursor-not-allowed';
export const btn = {
  ghost: `${btnBase} h-10 px-3.5 border-[#2b3b32] bg-[#16211b] text-[#e7efe9] hover:bg-[#1c2a22]`,
  primary: `${btnBase} h-10 px-3.5 border-emerald-500 bg-emerald-500 text-[#052e1f] hover:bg-emerald-400`,
  danger: `${btnBase} h-10 px-3.5 border-red-900 bg-transparent text-red-300 hover:bg-red-950/60`,
  red: `${btnBase} h-10 px-3.5 border-red-700 bg-red-700 text-white hover:bg-red-600`,
  small: `${btnBase} h-8 px-2.5 text-[12.5px] rounded-lg border-[#2b3b32] bg-[#16211b] text-[#e7efe9] hover:bg-[#1c2a22]`,
};
export const input = 'w-full h-10 rounded-xl border border-[#2b3b32] bg-[#0e1612] text-[#e7efe9] px-3 text-[14px] placeholder:text-[#6f8679] focus:outline-none focus:ring-2 focus:ring-emerald-500/40';
export const label = 'block text-[12.5px] font-semibold text-[#a9bdb2] mb-1.5';
export const muted = 'text-[#8fa69a]';
export const kicker = 'text-[11.5px] font-bold uppercase tracking-[0.06em] text-[#80988b]';
export const TONE = {
  ok: 'bg-[#0f2e22] text-[#6ee7b7]',
  warn: 'bg-[#3a2a0c] text-[#fcd34d]',
  bad: 'bg-[#3b1414] text-[#fca5a5]',
  info: 'bg-[#0f2440] text-[#93c5fd]',
  off: 'bg-[#262626] text-[#d4d4d4]',
};
export const th = 'text-left text-[11.5px] font-bold uppercase tracking-[0.04em] text-[#80988b] px-3 py-2.5 border-b border-[#1f2b24] whitespace-nowrap';
export const td = 'px-3 py-2.5 border-b border-[#18231d] whitespace-nowrap';
