// Check in at a shop: the phone's location and a shop photo are saved with the
// visit, so the manager knows it really happened. Pick one of your leads or add
// the shop you are standing in.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import { listLeads, addLead, lookupPhone, getLocation, uploadVisitPhoto, logActivity, updateLead } from './crmService.js';
import { phone10, BUSINESS_TYPES, whenPresets, forwardStage, LOST_REASONS } from './crmLogic.js';
import { Icon, Field, Notice, Spinner } from './ui.jsx';
import { btn, input, card } from './crmStyles.js';

const MET = [['owner', 'Owner'], ['staff', 'Staff only'], ['closed', 'Shop closed']];
const RESULTS = [
  ['interested', 'Interested', 'interested'], ['demo', 'Demo given / booked', 'demo'], ['think', 'Will think', 'contacted'],
  ['won', 'Won · paid', 'won'], ['lost', 'Not interested', 'lost'],
];
const NEXT = [['tomorrow', 'Tomorrow'], ['in3days', 'In 3 days'], ['nextweek', 'Next week'], ['none', 'No follow-up']];

function Chips({ items, value, onPick, label }) {
  return (
    <div>
      <p className="text-[13px] font-bold text-gray-700 mb-1.5">{label}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map(([k, text]) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onPick(k)}
            className={`min-h-[44px] px-2 rounded-xl border-2 text-[13.5px] font-bold ${value === k ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>{text}</button>
        ))}
      </div>
    </div>
  );
}

export default function CrmCheckin() {
  const { me, path } = useCrm();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [leads, setLeads] = useState(null);
  const [leadId, setLeadId] = useState(params.get('lead') || '');
  const [q, setQ] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [nf, setNf] = useState({ shop_name: '', phone: '', owner_name: '', business_type: '', area: '', city: '' });
  const [dupe, setDupe] = useState([]);
  const [loc, setLoc] = useState(null);
  const [locErr, setLocErr] = useState('');
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [met, setMet] = useState('owner');
  const [result, setResult] = useState('interested');
  const [lost, setLost] = useState(LOST_REASONS[0]);
  const [next, setNext] = useState('tomorrow');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => { listLeads().then((ls) => setLeads(ls.filter((l) => l.assigned_to === me.user_id || me.role === 'manager'))); }, [me]);
  const findLoc = () => { setLocErr(''); setLoc(null); getLocation().then(setLoc).catch((e) => setLocErr(e.message)); };
  useEffect(findLoc, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const p10 = phone10(nf.phone);
  useEffect(() => {
    if (!isNew || !p10) { setDupe([]); return undefined; }
    const t = setTimeout(() => lookupPhone(p10).then(setDupe), 300);
    return () => clearTimeout(t);
  }, [isNew, p10]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (leads || []).filter((l) => l.stage !== 'won' && l.stage !== 'lost')
      .filter((l) => !t || l.shop_name.toLowerCase().includes(t) || (l.area || '').toLowerCase().includes(t) || l.phone.includes(t.replace(/\D/g, '') || '~'))
      .slice(0, 8);
  }, [leads, q]);
  const chosen = (leads || []).find((l) => l.id === leadId);

  const pickPhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(f); setPreview(URL.createObjectURL(f));
  };

  const canSave = loc && photo && (chosen || (isNew && nf.shop_name.trim() && /^[6-9][0-9]{9}$/.test(p10) && !dupe.length));

  const save = async () => {
    setBusy(true); setErr('');
    try {
      let lead = chosen;
      if (!lead) {
        lead = await addLead({
          shop_name: nf.shop_name.trim(), phone: p10, owner_name: nf.owner_name.trim() || null, business_type: nf.business_type || null,
          area: nf.area.trim() || null, city: nf.city.trim() || null, source: 'field', assigned_to: me.user_id,
        });
      }
      const path_ = await uploadVisitPhoto(me.user_id, photo);
      const r = RESULTS.find((x) => x[0] === result);
      const stage = met === 'closed' ? null : (r[2] === 'won' || r[2] === 'lost' ? r[2] : forwardStage(lead.stage, r[2]));
      const at = next === 'none' || stage === 'won' || stage === 'lost' ? null : new Date(whenPresets()[next]).toISOString();
      await logActivity({
        leadId: lead.id, kind: 'visit', outcome: `${met}${met === 'closed' ? '' : `_${result}`}`, note,
        stage, nextAt: at, next: at ? (met === 'closed' ? 'Visit again (shop was closed)' : 'Follow up after visit') : null,
        lat: loc.lat, lng: loc.lng, acc: loc.acc, photo: path_, lost: stage === 'lost' ? lost : null,
      });
      if (stage === 'won') await updateLead(lead.id, { won_plan: 'monthly', won_amount: 1499 });
      setDone(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="px-4 py-10 max-w-md mx-auto text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-green-100 text-green-800 grid place-items-center mx-auto"><Icon name="check" size={28} /></div>
        <h1 className="text-xl font-extrabold">Visit saved</h1>
        <p className="text-sm text-gray-600">With the photo and your location. It shows in the lead’s history and your manager’s visit list.</p>
        <div className="flex gap-2 justify-center">
          <button type="button" className={btn.primary} onClick={() => navigate(0)}>Next shop</button>
          <Link to={path()} className={btn.ghost}>Done</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-7 py-5 max-w-2xl space-y-4">
      <h1 className="text-2xl font-extrabold">Check in at a shop</h1>

      <div className={`${card} p-4 flex gap-3 items-center ${loc ? 'bg-green-50 border-green-200' : ''}`}>
        <Icon name="pin" className={loc ? 'text-green-700' : 'text-gray-500'} />
        <div className="flex-1 text-sm">
          {loc ? <><b>Location saved</b> · accurate to {loc.acc} m</> : locErr ? <span className="text-red-700">{locErr}</span> : 'Finding your location…'}
        </div>
        {!loc && <button type="button" className={btn.small} onClick={findLoc}>Try again</button>}
      </div>

      <section className={`${card} p-4 space-y-3`}>
        <div className="flex gap-2">
          <button type="button" aria-pressed={!isNew} onClick={() => setIsNew(false)} className={`flex-1 h-11 rounded-xl border-2 text-sm font-bold ${!isNew ? 'border-green-700 bg-green-50' : 'border-gray-200'}`}>One of my leads</button>
          <button type="button" aria-pressed={isNew} onClick={() => { setIsNew(true); setLeadId(''); }} className={`flex-1 h-11 rounded-xl border-2 text-sm font-bold ${isNew ? 'border-green-700 bg-green-50' : 'border-gray-200'}`}>New shop here</button>
        </div>
        {!isNew ? (
          chosen ? (
            <div className="flex items-center gap-3 border border-green-200 bg-green-50 rounded-xl px-3 py-2.5">
              <div className="flex-1"><div className="font-bold">{chosen.shop_name}</div><div className="text-[12.5px] text-gray-600">{[chosen.area, chosen.city].filter(Boolean).join(', ')}</div></div>
              <button type="button" className={btn.small} onClick={() => setLeadId('')}>Change</button>
            </div>
          ) : (
            <>
              <input aria-label="Find the shop" className={input} placeholder="Find the shop: name, area or phone" value={q} onChange={(e) => setQ(e.target.value)} />
              {!leads ? <Spinner /> : (
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-xl">
                  {matches.map((l) => (
                    <li key={l.id}><button type="button" onClick={() => setLeadId(l.id)} className="w-full text-left px-3 py-2.5">
                      <span className="block font-bold text-[14px]">{l.shop_name}</span><span className="block text-[12.5px] text-gray-500">{[l.area, l.city].filter(Boolean).join(', ')}</span></button></li>
                  ))}
                  {!matches.length && <li className="px-3 py-3 text-sm text-gray-500">No match. Use “New shop here”.</li>}
                </ul>
              )}
            </>
          )
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Shop name *" htmlFor="ns"><input id="ns" className={input} value={nf.shop_name} onChange={(e) => setNf({ ...nf, shop_name: e.target.value })} /></Field>
            <Field label="Mobile *" htmlFor="np"><input id="np" inputMode="tel" className={input} value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} /></Field>
            <Field label="Owner’s name" htmlFor="no"><input id="no" className={input} value={nf.owner_name} onChange={(e) => setNf({ ...nf, owner_name: e.target.value })} /></Field>
            <Field label="Type of business" htmlFor="nb">
              <select id="nb" className={input} value={nf.business_type} onChange={(e) => setNf({ ...nf, business_type: e.target.value })}>
                <option value="">Pick one</option>{BUSINESS_TYPES.map((b) => <option key={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Area" htmlFor="na"><input id="na" className={input} value={nf.area} onChange={(e) => setNf({ ...nf, area: e.target.value })} /></Field>
            <Field label="City" htmlFor="nc"><input id="nc" className={input} value={nf.city} onChange={(e) => setNf({ ...nf, city: e.target.value })} /></Field>
            {dupe.length > 0 && <div className="sm:col-span-2"><Notice kind="warn">This number is already a lead: {dupe[0].shop_name}{dupe[0].owner_name ? `, with ${dupe[0].owner_name}` : ''}. Ask your manager to give it to you.</Notice></div>}
          </div>
        )}
      </section>

      <section className={`${card} p-4 space-y-4`}>
        <div>
          <p className="text-[13px] font-bold text-gray-700 mb-1.5">Shop photo *</p>
          {preview ? (
            <div className="flex items-center gap-3">
              <img src={preview} alt="Shop front" className="w-28 h-28 rounded-xl object-cover border border-gray-200" />
              <label className={`${btn.small} cursor-pointer`}>Retake<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pickPhoto} /></label>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-1.5 h-28 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-sm font-bold text-gray-700 cursor-pointer">
              <Icon name="camera" size={24} />Take a photo of the shop front
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pickPhoto} />
            </label>
          )}
        </div>
        <Chips label="Who did you meet?" items={MET} value={met} onPick={setMet} />
        {met !== 'closed' && <Chips label="How did it go?" items={RESULTS.map(([k, t]) => [k, t])} value={result} onPick={setResult} />}
        {met !== 'closed' && result === 'lost' && (
          <Field label="Why not?" htmlFor="lr"><select id="lr" className={input} value={lost} onChange={(e) => setLost(e.target.value)}>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
        )}
        {!(met !== 'closed' && (result === 'won' || result === 'lost')) && <Chips label="Next step" items={NEXT} value={next} onPick={setNext} />}
        <Field label="Note" htmlFor="vn"><textarea id="vn" rows={2} className={`${input} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did they say?" /></Field>
        {err && <Notice>{err}</Notice>}
        <button type="button" className={`${btn.primary} w-full h-12`} disabled={!canSave || busy} onClick={save}>
          {busy ? 'Saving…' : !loc ? 'Waiting for your location' : !photo ? 'Take the shop photo to save' : 'Save visit'}
        </button>
      </section>
    </div>
  );
}
