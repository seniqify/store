// Manager or Ads & leads: import a list of shops from Excel (.xlsx) or CSV.
// Match the columns, see what will be skipped (already in the CRM, twice in
// the file, wrong mobile), choose who gets them (manager), import. A Meta /
// Google lead-form export works too: pick "Facebook ad" etc. as where they
// came from. An Ads & leads import has no owner: it waits in Check leads.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import { listLeads, importLeads, autoAssign, downloadCsv } from './crmService.js';
import { readXlsx } from './crmXlsx.js';
import { parseCsv, guessColumns, planImport, IMPORT_FIELDS, SOURCES, splitEvenly, fewestFirst } from './crmLogic.js';
import { Icon, Field, Notice } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

const IMPORT_SOURCES = ['import', 'calling_list', 'walk_in', 'facebook', 'instagram', 'google', 'website', 'referral'];

export default function CrmImport() {
  const { me, staff, settings, path } = useCrm();
  const isAds = me.role === 'ads';
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [map, setMap] = useState({});
  const [hasHeader, setHasHeader] = useState(true);
  const [existing, setExisting] = useState(null);
  const [openCounts, setOpenCounts] = useState({});
  const [how, setHow] = useState('none');
  const [one, setOne] = useState('');
  const [pick, setPick] = useState(new Set());
  const [listName, setListName] = useState('');
  const [source, setSource] = useState(isAds ? 'facebook' : 'import');
  const [showSkipped, setShowSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const rulesOn = !!settings?.auto_assign?.on;
  const people = useMemo(() => staff.filter((s) => s.active && s.role !== 'ads'), [staff]);

  useEffect(() => {
    listLeads().then((ls) => {
      setExisting(new Set(ls.map((l) => l.phone)));
      const c = {};
      for (const l of ls) if (l.assigned_to && l.stage !== 'won' && l.stage !== 'lost') c[l.assigned_to] = (c[l.assigned_to] || 0) + 1;
      setOpenCounts(c);
    });
  }, []);

  const readFile = async (f) => {
    setErr(''); setRows(null); setDone(null);
    if (!f) return;
    try {
      const name = f.name.toLowerCase();
      let r;
      if (name.endsWith('.xlsx')) r = await readXlsx(await f.arrayBuffer());
      else if (name.endsWith('.xls')) throw new Error('This is an old Excel file (.xls). In Excel: File → Save as → Excel Workbook (.xlsx) or CSV, then choose it again.');
      else r = parseCsv(await f.text());
      if (!r.length) throw new Error('The file is empty.');
      if (r.length > 5001) throw new Error('Up to 5,000 rows at a time. Split the file and import it in parts.');
      setFile(f); setRows(r);
      const g = guessColumns(r[0]);
      const headerLike = g.phone >= 0 || g.shop_name >= 0;
      setHasHeader(headerLike);
      setMap(headerLike ? g : { shop_name: 0, phone: 1, owner_name: -1, city: -1, area: -1, business_type: -1, note: -1 });
      setListName(f.name.replace(/\.[^.]+$/, '').slice(0, 80));
    } catch (e) { setErr(e.message || 'Could not read this file.'); setFile(null); }
  };

  const plan = useMemo(() => (rows && existing ? planImport(rows, map, existing, { hasHeader }) : null), [rows, map, existing, hasHeader]);
  const cols = rows ? Math.max(...rows.slice(0, 50).map((r) => r.length)) : 0;
  const colName = (i) => (hasHeader ? rows[0][i] || `Column ${i + 1}` : `Column ${i + 1}`);
  const example = (i) => (rows ? (rows[hasHeader ? 1 : 0] || [])[i] || '' : '');
  const chosen = useMemo(() => (how === 'one' ? (one ? [one] : []) : [...pick]), [how, one, pick]);
  const ready = plan && plan.ready.length > 0 && map.phone >= 0 && map.shop_name >= 0
    && (how === 'none' || how === 'rules' || chosen.length > 0);

  const preview = useMemo(() => {
    if (!plan) return {};
    const n = plan.ready.length;
    if (how === 'split') return Object.fromEntries(Object.entries(splitEvenly(plan.ready.map((_, i) => i), chosen)).map(([u, xs]) => [u, xs.length]));
    if (how === 'fewest') return fewestFirst(n, chosen, openCounts);
    if (how === 'one' && one) return { [one]: n };
    return {};
  }, [plan, how, chosen, one, openCounts]);

  const run = async () => {
    setBusy(true); setErr(''); setProgress(0);
    try {
      const n = plan.ready.length;
      const owners = new Array(n).fill(null);
      if (how === 'one') owners.fill(one);
      if (how === 'split') Object.entries(splitEvenly(plan.ready.map((_, i) => i), chosen)).forEach(([u, xs]) => xs.forEach((i) => { owners[i] = u; }));
      if (how === 'fewest') {
        let i = 0;
        for (const [u, k] of Object.entries(fewestFirst(n, chosen, openCounts))) for (let j = 0; j < k; j++) owners[i++] = u;
      }
      const at = new Date(Date.now() + 5 * 60000).toISOString();
      const leads = plan.ready.map((l, i) => ({
        shop_name: l.shop_name, phone: l.phone, owner_name: l.owner_name, city: l.city, area: l.area, business_type: l.business_type,
        source, source_detail: listName.trim().slice(0, 200) || null, assigned_to: owners[i],
        next_action_at: at, next_action: l.note ? `Call · ${l.note}`.slice(0, 200) : 'Call',
      }));
      const ids = await importLeads(leads, setProgress);
      let given = owners.filter(Boolean).length;
      if (how === 'rules' && ids.length) given = await autoAssign(ids);
      setDone({ added: ids.length, given, skipped: plan.dupes.length + plan.bad.length + (n - ids.length) });
      setRows(null); setFile(null);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const sample = () => downloadCsv('pocketlink-leads-sample.csv', [
    ['Shop name', 'Owner name', 'Mobile', 'City', 'Area', 'Type of business', 'Note'],
    ['Laxmi Kirana Stores', 'Ramesh Patil', '9822461530', 'Solapur', 'Saat Rasta', 'Kirana and grocery', 'Met at the expo'],
  ]);

  if (done) {
    return (
      <section className={`${card} p-6 text-center space-y-3`}>
        <div className="w-14 h-14 rounded-full bg-green-100 text-green-800 grid place-items-center mx-auto"><Icon name="check" size={28} /></div>
        <h2 className="text-xl font-extrabold">{done.added} lead{done.added === 1 ? '' : 's'} added</h2>
        {isAds ? <p className="text-sm text-gray-600">They wait in Check leads{done.skipped ? ` · ${done.skipped} skipped` : ''}. Check each one, then give the checked ones out by the rules.</p>
          : <p className="text-sm text-gray-600">{done.given} given out{done.skipped ? ` · ${done.skipped} skipped` : ''}. Each person sees theirs at the top of their queue.</p>}
        {isAds ? (
          <div className="flex gap-2 justify-center">
            <Link to={path('check')} className={btn.primary}>Check them now</Link>
            <button type="button" className={btn.ghost} onClick={() => setDone(null)}>Import another</button>
          </div>
        ) : (
        <div className="flex gap-2 justify-center">
          <Link to={path('leads')} className={btn.primary}>See the leads</Link>
          {done.added > done.given && <Link to={path('assign')} className={btn.ghost}>Assign the rest</Link>}
          <button type="button" className={btn.ghost} onClick={() => setDone(null)}>Import another</button>
        </div>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className={`${card} p-5 space-y-3`}>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${btn.primary} cursor-pointer`}>
            <Icon name="upload" size={16} />{file ? 'Choose another file' : 'Choose an Excel or CSV file'}
            <input type="file" accept=".xlsx,.csv,.txt,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only"
              onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <button type="button" className={btn.ghost} onClick={sample}>Download a sample file</button>
        </div>
        {file && rows && <p className="text-sm text-gray-600"><b>{file.name}</b> · {rows.length - (hasHeader ? 1 : 0)} rows read</p>}
        {!file && <p className="text-[13px] text-gray-500">Any column order. Needs at least the shop (or person’s) name and a 10-digit mobile. Up to 5,000 rows at a time.</p>}
        {err && <Notice>{err}</Notice>}
      </section>

      {rows && (
        <>
          <section className={`${card} p-5 space-y-3`}>
            <h2 className="font-extrabold">1. Match your columns</h2>
            <label className="flex items-center gap-2 text-[13px] font-semibold text-gray-700">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="w-4 h-4 accent-green-700" />The first row has the column names
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              {IMPORT_FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} htmlFor={`m-${f.key}`}
                  hint={map[f.key] >= 0 && example(map[f.key]) ? `e.g. ${example(map[f.key])}` : null}>
                  <select id={`m-${f.key}`} className={input} value={map[f.key] ?? -1} onChange={(e) => setMap({ ...map, [f.key]: Number(e.target.value) })}>
                    <option value={-1}>{f.required ? 'Pick the column' : 'Not in the file'}</option>
                    {Array.from({ length: cols }, (_, i) => <option key={i} value={i}>{colName(i)}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </section>

          {plan && (
            <section className={`${card} p-5 space-y-3`}>
              <h2 className="font-extrabold">2. We checked the list</h2>
              <ul className="space-y-1 text-sm">
                <li className="font-bold text-green-800">{plan.ready.length} new leads ready</li>
                {plan.dupes.length > 0 && <li className="text-gray-700">{plan.dupes.length} already in the CRM or twice in the file · skipped</li>}
                {plan.bad.length > 0 && <li className="text-gray-700">{plan.bad.length} with a wrong mobile or no name · skipped</li>}
              </ul>
              {(plan.dupes.length + plan.bad.length) > 0 && (
                <button type="button" className="text-[13px] font-bold text-green-700" onClick={() => setShowSkipped(!showSkipped)}>{showSkipped ? 'Hide' : 'See'} skipped rows</button>
              )}
              {showSkipped && (
                <ul className="max-h-60 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100 text-[13px]">
                  {[...plan.bad, ...plan.dupes].sort((a, b) => a.line - b.line).map((x) => (
                    <li key={x.line} className="px-3 py-1.5"><b>Row {x.line}</b> · {x.why} · {x.value}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {plan && plan.ready.length > 0 && (
            <section className={`${card} p-5 space-y-3`}>
              <h2 className="font-extrabold">3. {isAds ? 'Name the list' : 'Who gets them?'}</h2>
              {isAds && <p className="text-[13.5px] text-gray-700">They come in with no owner and wait in Check leads. You check them, then give the good ones out by the rules.</p>}
              {!isAds && <div className="grid sm:grid-cols-2 gap-2">
                {[
                  ['none', 'Leave them unassigned', 'Give them out later in Assign'],
                  ...(rulesOn ? [['rules', 'Follow my auto-assign rules', 'As set in Assign']] : []),
                  ['one', 'One person', ''],
                  ['split', 'Split evenly', 'Between the people you tick'],
                  ['fewest', 'Fewest open leads first', 'Evens out the load'],
                ].map(([k, label, sub]) => (
                  <button key={k} type="button" aria-pressed={how === k} onClick={() => setHow(k)}
                    className={`text-left rounded-xl border-2 px-3 py-2.5 ${how === k ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>
                    <span className="block font-bold text-[14px]">{label}</span>{sub && <span className="block text-[12px] text-gray-500">{sub}</span>}
                  </button>
                ))}
              </div>}
              {how === 'one' && (
                <select aria-label="Give them to" className={input} value={one} onChange={(e) => setOne(e.target.value)}>
                  <option value="">Pick a person</option>
                  {people.map((s) => <option key={s.user_id} value={s.user_id}>{s.name} · {s.role} · {openCounts[s.user_id] || 0} open</option>)}
                </select>
              )}
              {(how === 'split' || how === 'fewest') && (
                <div className="grid sm:grid-cols-2 gap-2">
                  {people.map((s) => {
                    const on = pick.has(s.user_id);
                    return (
                      <label key={s.user_id} className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2 cursor-pointer ${on ? 'border-green-700 bg-green-50' : 'border-gray-200'}`}>
                        <input type="checkbox" checked={on} className="w-4 h-4 accent-green-700"
                          onChange={() => { const n = new Set(pick); if (on) n.delete(s.user_id); else n.add(s.user_id); setPick(n); }} />
                        <span className="flex-1 min-w-0"><span className="block font-bold text-[14px]">{s.name}</span><span className="block text-[12px] text-gray-500">{s.role} · {openCounts[s.user_id] || 0} open</span></span>
                        {on && preview[s.user_id] != null && <span className="text-[13px] font-extrabold text-green-800">+{preview[s.user_id]}</span>}
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Name this list" htmlFor="ln"><input id="ln" className={input} value={listName} onChange={(e) => setListName(e.target.value)} placeholder="e.g. Solapur expo, November" /></Field>
                <Field label="They came from" htmlFor="lsrc">
                  <select id="lsrc" className={input} value={source} onChange={(e) => setSource(e.target.value)}>
                    {IMPORT_SOURCES.map((k) => <option key={k} value={k}>{SOURCES[k]}</option>)}
                  </select>
                </Field>
              </div>
              <p className="text-[12.5px] text-gray-500">{isAds ? 'Each lead gets a “Call” follow-up, so the caller it goes to sees it first.' : 'Each lead gets a “Call” follow-up for today, so none is forgotten.'} The note column (if any) goes with it.</p>
              <button type="button" className={`${btn.primary} w-full h-12`} disabled={!ready || busy} onClick={run}>
                {busy ? `Importing… ${progress} of ${plan.ready.length}` : `Import ${plan.ready.length} lead${plan.ready.length === 1 ? '' : 's'}`}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
