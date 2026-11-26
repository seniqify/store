// The audit log: every change made in Admin, who made it, from where, and
// what changed. Nobody can edit or delete it (the database refuses).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from './adminContext.js';
import { adminLog, downloadCsv } from './adminService.js';
import { whenLabel, actionLabel, diffLine, toCsv, ROLE_LABEL } from './adminLogic.js';
import { Icon, Panel, Spinner, Notice, Empty } from './ui.jsx';
import { btn, input, th, td } from './adminStyles.js';

export default function AdminLog() {
  const { path } = useAdmin();
  const [kind, setKind] = useState('');
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(true);
  const [err, setErr] = useState('');
  const load = useCallback(async (k, before = null) => {
    try {
      const r = await adminLog(k || null, before);
      setRows((prev) => (before ? [...(prev || []), ...r] : r));
      setMore(r.length === 200);
    } catch (x) { setErr(x.message); }
  }, []);
  useEffect(() => { load(kind); }, [kind, load]);

  const exportCsv = () => downloadCsv('pocketlink-admin-log.csv', toCsv([
    ['When', 'Who', 'Role', 'Did', 'To', 'Change', 'Reason', 'From'],
    ...(rows || []).map((r) => [whenLabel(r.at), r.actor_name, ROLE_LABEL[r.actor_role] || r.actor_role, actionLabel(r.action), r.target, diffLine(r.before, r.after), r.reason, r.ip]),
  ]));

  if (err) return <Notice>{err}</Notice>;
  return (
    <div className="space-y-4 max-w-[1400px]">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="m-0 text-[26px] font-extrabold">Audit log</h1>
          <p className="m-0 mt-1 text-[14px] text-[#8fa69a]">Every change made in Admin. Nobody can edit or delete it, not even the Owner.</p>
        </div>
        <select aria-label="Kind" className={`${input} w-auto`} value={kind} onChange={(e) => { setRows(null); setKind(e.target.value); }}>
          <option value="">All changes</option><option value="plan">Plans</option><option value="edit">Shop details</option><option value="paused">Pauses</option><option value="deleted">Deletes</option><option value="open">Opened again</option><option value="switch">Switches</option><option value="job">Jobs</option><option value="purged">Removed for good</option>
        </select>
        <button type="button" className={btn.ghost} onClick={exportCsv} disabled={!rows?.length}><Icon name="download" size={16} />Export</button>
      </header>
      <Panel title="Changes" className="overflow-hidden">
        {!rows ? <Spinner /> : !rows.length ? <Empty>No changes yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead><tr>{['When', 'Who', 'Did', 'To', 'Change', 'Reason', 'From'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className={`${td} text-[#8fa69a]`}>{whenLabel(r.at)}</td>
                    <td className={td}><b>{r.actor_name || 'Unknown'}</b><div className="text-[12px] text-[#8fa69a]">{ROLE_LABEL[r.actor_role] || ''}</div></td>
                    <td className={td}>{actionLabel(r.action)}</td>
                    <td className={td}>{r.target_kind === 'store' ? <Link to={path(`stores/${r.target}`)}>{r.target}</Link> : r.target}</td>
                    <td className={`${td} whitespace-normal min-w-[260px] text-[#c8d6ce]`}>{diffLine(r.before, r.after)}</td>
                    <td className={`${td} whitespace-normal min-w-[180px] text-[#8fa69a]`}>{r.reason || ''}</td>
                    <td className={`${td} text-[#8fa69a]`}>{r.ip || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows?.length > 0 && more && <div className="px-4 py-3"><button type="button" className={btn.small} onClick={() => load(kind, rows[rows.length - 1].at)}>Show older</button></div>}
      </Panel>
    </div>
  );
}
