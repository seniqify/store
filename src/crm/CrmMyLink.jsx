// "My sign-up link": the person's own PocketLink sign-up link and code. A shop
// that signs up with it and pays is their win, marked by the CRM itself.
import { useEffect, useState } from 'react';
import { useCrm } from './crmContext.js';
import { myLinkStats } from './crmService.js';
import { signupLink } from './crmLogic.js';
import { Icon } from './ui.jsx';
import { btn, card } from './crmStyles.js';

export default function MyLinkCard({ compact = false }) {
  const { me } = useCrm();
  const [stats, setStats] = useState(null);
  const [copied, setCopied] = useState('');
  useEffect(() => { let alive = true; myLinkStats().then((s) => { if (alive) setStats(s); }); return () => { alive = false; }; }, []);
  const code = stats?.ref_code || me.ref_code;
  if (!code) return null;
  const link = signupLink(code);
  const copy = async (what, text) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500); } catch { /* old browser */ } };
  const share = `Make your shop's own online page on PocketLink: ${link} (my code: ${code})`;
  return (
    <section className={`${card} p-4 space-y-2`} aria-label="My sign-up link">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-extrabold">My sign-up link</h2>
          {!compact && <p className="text-[13px] text-gray-600">Use it with every shop. When a shop that signed up with it pays, the win is yours by itself.</p>}
        </div>
        <span className="text-[18px] font-extrabold tracking-[0.18em] bg-gray-900 text-white rounded-lg px-2.5 py-1">{code}</span>
      </div>
      <p className="text-[13px] font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 break-all">{link}</p>
      <div className="flex flex-wrap gap-2">
        <a className={btn.smallGreen} href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer"><Icon name="wa" size={14} />Share on WhatsApp</a>
        <button type="button" className={btn.small} onClick={() => copy('link', link)}><Icon name={copied === 'link' ? 'check' : 'copy'} size={14} />{copied === 'link' ? 'Copied' : 'Copy link'}</button>
        <button type="button" className={btn.small} onClick={() => copy('code', code)}><Icon name={copied === 'code' ? 'check' : 'copy'} size={14} />{copied === 'code' ? 'Copied' : 'Copy code'}</button>
      </div>
      {stats && <p className="text-[12.5px] text-gray-500">This month: {stats.signups} sign-up{stats.signups === 1 ? '' : 's'} with your link · {stats.paid} paid</p>}
    </section>
  );
}
