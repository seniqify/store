// Scripts: what to say on a first call, after a sign-up and on a shop visit,
// in English, Marathi or Hindi; answers to objections; an example shop per
// type of business; WhatsApp messages to copy or send. Opened from a lead
// (?lead=<id>), the lead's shop and owner name are filled in.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import { getLead } from './crmService.js';
import { waHref, signupLink } from './crmLogic.js';
import { LANGS, SCRIPT_LIST, SCRIPTS, OBJECTIONS, OBJ_TITLE, BUSINESS_HOOKS, MESSAGES, shopLink, fillScript } from './crmScripts.js';
import { Icon } from './ui.jsx';
import { btn, card } from './crmStyles.js';

const LANG_KEY = 'crm-script-lang';

/** A script line with any {placeholder} still unknown shown as a chip. */
function Line({ text, className = '' }) {
  const parts = String(text).split(/(\{[a-z ]+\})/g);
  return (
    <span className={className}>
      {parts.map((p, i) => (/^\{[a-z ]+\}$/.test(p)
        ? <span key={i} className="inline-block rounded bg-amber-100 text-amber-900 px-1 font-bold">{p.slice(1, -1)}</span>
        : <span key={i}>{p}</span>))}
    </span>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={btn.small} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* old browser */ }
    }}><Icon name={done ? 'check' : 'copy'} size={14} />{done ? 'Copied' : 'Copy'}</button>
  );
}

export default function CrmScripts() {
  const { me } = useCrm();
  const [params, setParams] = useSearchParams();
  const [lang, setLang] = useState(() => { try { return localStorage.getItem(LANG_KEY) || 'en'; } catch { return 'en'; } });
  const which = SCRIPTS[params.get('s')] ? params.get('s') : 'first';
  const [lead, setLead] = useState(null);
  const [openObj, setOpenObj] = useState(0);

  const leadId = params.get('lead');
  useEffect(() => {
    if (!leadId) { setLead(null); return undefined; }
    let alive = true;
    getLead(leadId).then((l) => { if (alive) setLead(l); }).catch(() => {});
    return () => { alive = false; };
  }, [leadId]);

  const pickLang = (k) => { setLang(k); try { localStorage.setItem(LANG_KEY, k); } catch { /* private mode */ } };
  const pickScript = (k) => { const p = new URLSearchParams(params); p.set('s', k); setParams(p, { replace: true }); };
  const values = { me: me.name.split(' ')[0], shop: lead?.shop_name, owner: lead?.owner_name, 'my link': me.ref_code ? signupLink(me.ref_code) : '' };
  const cur = SCRIPTS[which][lang];

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]"><h1 className="text-2xl font-extrabold">Scripts</h1>
          <p className="text-sm text-gray-500">{lead ? <>For <b>{lead.shop_name}</b>{lead.owner_name ? ` · ${lead.owner_name}` : ''}</> : 'What to say. Open it from a lead to fill in their name.'}</p></div>
        <div className="flex gap-1.5 bg-white border border-gray-200 rounded-full p-1" role="group" aria-label="Language">
          {LANGS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={lang === k} onClick={() => pickLang(k)}
              className={`h-8 px-3 rounded-full text-[13px] font-bold ${lang === k ? 'bg-gray-900 text-white' : 'text-gray-700'}`}>{label}</button>
          ))}
        </div>
      </header>

      <div className="flex flex-col xl:flex-row gap-4 items-start">
        <div className="w-full xl:w-64 shrink-0 grid grid-cols-3 xl:grid-cols-1 gap-2">
          {SCRIPT_LIST.map(([k, when]) => (
            <button key={k} type="button" aria-pressed={which === k} onClick={() => pickScript(k)}
              className={`text-left rounded-xl border-2 px-3 py-2.5 ${which === k ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>
              <span className="block font-bold text-[14px] leading-tight">{SCRIPTS[k][lang].title}</span>
              <span className="block text-[12px] text-gray-500 mt-0.5">{when}</span>
            </button>
          ))}
        </div>

        <section aria-label="Script" className={`${card} flex-1 min-w-0 w-full p-4 space-y-3`} lang={lang}>
          <div><h2 className="text-lg font-extrabold">{cur.title}</h2><p className="text-[13px] text-gray-500">{cur.time} · {cur.goal}</p></div>
          <ol className="space-y-3">
            {cur.steps.map(([label, say, tip], i) => (
              <li key={label} className="flex gap-3">
                <span aria-hidden="true" className="w-7 h-7 shrink-0 rounded-full bg-green-700 text-white grid place-items-center text-[13px] font-extrabold">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-extrabold uppercase tracking-wide text-gray-500">{label}</div>
                  <p className="text-[16px] leading-relaxed font-semibold text-gray-900"><Line text={fillScript(say, values)} /></p>
                  {tip && <p className="text-[13px] text-gray-600 mt-0.5"><b>Tip:</b> <Line text={tip} /></p>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Objections" className={`${card} w-full xl:w-[400px] shrink-0 overflow-hidden`} lang={lang}>
          <h2 className="px-4 pt-3 pb-2 font-extrabold">{OBJ_TITLE[lang]}</h2>
          <ul className="divide-y divide-gray-100">
            {OBJECTIONS[lang].map(([q, a], i) => (
              <li key={q}>
                <button type="button" aria-expanded={openObj === i} onClick={() => setOpenObj(openObj === i ? -1 : i)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left font-bold text-[14px]">
                  <span className="flex-1">“{q}”</span><span aria-hidden="true" className="text-gray-400">{openObj === i ? '−' : '+'}</span>
                </button>
                {openObj === i && <p className="px-4 pb-3 text-[14px] text-gray-800">{a}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section aria-label="By type of business" className={`${card} overflow-hidden`}>
          <h2 className="px-4 pt-3 pb-1 font-extrabold">By type of business</h2>
          <p className="px-4 pb-2 text-[12.5px] text-gray-500">Send the example shop so they see a real one like theirs.</p>
          <ul className="divide-y divide-gray-100">
            {BUSINESS_HOOKS.map((b) => (
              <li key={b.t} className="px-4 py-3">
                <div className="font-bold text-[14px]">{b.t}</div>
                <p className="text-[13.5px] text-gray-700">{b.hook}</p>
                {b.shop && (
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    <a href={shopLink(b.shop)} target="_blank" rel="noreferrer" className={btn.small}>Open example</a>
                    <a href={lead ? waHref(lead.phone, `Namaskar${lead.owner_name ? ` ${lead.owner_name}` : ''}, here is a shop like yours on PocketLink: ${shopLink(b.shop)}`) : `https://wa.me/?text=${encodeURIComponent(shopLink(b.shop))}`}
                      target="_blank" rel="noreferrer" className={btn.smallGreen}><Icon name="wa" size={14} />Send on WhatsApp</a>
                    <CopyButton text={shopLink(b.shop)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="WhatsApp messages" className={`${card} overflow-hidden`}>
          <h2 className="px-4 pt-3 pb-1 font-extrabold">WhatsApp messages</h2>
          <p className="px-4 pb-2 text-[12.5px] text-gray-500">Fill the marked parts before sending.</p>
          <ul className="divide-y divide-gray-100">
            {MESSAGES.map((m) => {
              const text = fillScript(m.text, values);
              return (
                <li key={m.t} className="px-4 py-3 space-y-1.5">
                  <div className="font-bold text-[14px]">{m.t}</div>
                  <p className="text-[14px] text-gray-800 bg-gray-50 rounded-lg px-3 py-2"><Line text={text} /></p>
                  <div className="flex gap-2">
                    <CopyButton text={text} />
                    {lead && <a href={waHref(lead.phone, text)} target="_blank" rel="noreferrer" className={btn.smallGreen}><Icon name="wa" size={14} />Open in WhatsApp</a>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
