import { useState, useEffect } from 'react';
import { Megaphone, Send, Plus, X, Check, Loader2, Pencil, ShieldCheck } from 'lucide-react';
import { getWhatsappConfig, saveWhatsappConfig, buildRecipients, sendCampaign } from '../../utils/whatsappCampaign';

/**
 * CampaignPanel — connect the store's own Seniqify template + broadcast to the
 * customers currently shown (the active segment). Setup is one-time: paste the
 * template's API URL and Bearer key; then it's pick-segment → Send.
 */
export default function CampaignPanel({ slug, pin, businessName = '', audience = [], audienceLabel = 'all' }) {
  const [cfg,        setCfg]        = useState(undefined); // undefined = loading
  const [editing,    setEditing]    = useState(false);
  const [form,       setForm]       = useState({ templateUrl: '', apiKey: '', varTemplates: ['{name}'] });
  const [saving,     setSaving]     = useState(false);
  const [saveErr,    setSaveErr]    = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending,    setSending]    = useState(false);
  const [result,     setResult]     = useState(null);

  useEffect(() => {
    let alive = true;
    getWhatsappConfig(slug, pin).then((c) => {
      if (!alive) return;
      const safe = c || { configured: false, template_url: '', api_key_masked: '', var_templates: ['{name}'] };
      setCfg(safe);
      setForm({
        templateUrl: safe.template_url || '',
        apiKey: '',
        varTemplates: Array.isArray(safe.var_templates) && safe.var_templates.length ? safe.var_templates : ['{name}'],
      });
    });
    return () => { alive = false; };
  }, [slug, pin]);

  async function save() {
    setSaveErr('');
    if (!form.templateUrl.trim()) { setSaveErr('Paste the template API URL from Seniqify.'); return; }
    if (!cfg?.configured && !form.apiKey.trim()) { setSaveErr('Paste your API key.'); return; }
    setSaving(true);
    try {
      const varTemplates = form.varTemplates.map((t) => t.trim()).filter(Boolean);
      await saveWhatsappConfig(slug, pin, {
        templateUrl: form.templateUrl.trim(),
        apiKey: form.apiKey.trim(),
        varTemplates: varTemplates.length ? varTemplates : ['{name}'],
      });
      const fresh = await getWhatsappConfig(slug, pin);
      setCfg(fresh);
      setForm((f) => ({ ...f, apiKey: '', varTemplates }));
      setEditing(false);
    } catch (e) {
      setSaveErr(e.message || 'Could not save. Did you run the SQL setup?');
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    setSending(true);
    setResult(null);
    try {
      const recipients = buildRecipients(audience, cfg?.var_templates || form.varTemplates, businessName);
      const r = await sendCampaign(slug, pin, recipients);
      setResult({ ok: true, ...r });
    } catch (e) {
      setResult({ ok: false, error: e.message || 'Send failed' });
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  if (cfg === undefined) {
    return <div className="h-12 rounded-2xl bg-white border border-gray-100 animate-pulse" />;
  }

  // ── Setup form (first connect or edit) ──
  if (editing || !cfg.configured) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Megaphone size={16} className="text-emerald-600" />
          <p className="font-bold text-gray-900 text-sm">Connect WhatsApp campaigns</p>
        </div>
        <p className="text-[12px] text-gray-500 leading-relaxed">
          Create &amp; get a template approved on Seniqify, then paste its API link and key below.
          Sending &amp; delivery happen on Seniqify — PocketLink just personalises &amp; sends to your customers.
        </p>

        <Field label="Template API URL">
          <input value={form.templateUrl} onChange={(e) => setForm((f) => ({ ...f, templateUrl: e.target.value }))}
            placeholder="https://adminapis.backendprod.com/lms_campaign/api/whatsapp/template/…/process"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-200" />
        </Field>

        <Field label={cfg.configured ? 'API key (leave blank to keep saved)' : 'API key (Bearer token)'}>
          <input value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            placeholder={cfg.api_key_masked ? `${cfg.api_key_masked} (saved)` : 'Paste your key'}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-200" />
        </Field>

        <Field label="Message variables">
          <p className="text-[11px] text-gray-400 mb-1.5">
            One per template placeholder ({'{{1}}'}, {'{{2}}'}…). Use <b>{'{name}'}</b> for the customer's name, <b>{'{shop}'}</b> for your shop.
          </p>
          <div className="space-y-1.5">
            {form.varTemplates.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-gray-400 w-7 flex-shrink-0">{`{{${i + 1}}}`}</span>
                <input value={v}
                  onChange={(e) => setForm((f) => ({ ...f, varTemplates: f.varTemplates.map((x, j) => (j === i ? e.target.value : x)) }))}
                  className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-200" />
                {form.varTemplates.length > 1 && (
                  <button onClick={() => setForm((f) => ({ ...f, varTemplates: f.varTemplates.filter((_, j) => j !== i) }))}
                    className="text-gray-300 hover:text-red-500"><X size={15} /></button>
                )}
              </div>
            ))}
          </div>
          {form.varTemplates.length < 6 && (
            <button onClick={() => setForm((f) => ({ ...f, varTemplates: [...f.varTemplates, ''] }))}
              className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600">
              <Plus size={13} /> Add variable
            </button>
          )}
        </Field>

        {saveErr && <p className="text-[12px] text-red-500">{saveErr}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-4 py-2 rounded-xl bg-emerald-600 active:scale-95 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
          </button>
          {cfg.configured && (
            <button onClick={() => { setEditing(false); setSaveErr(''); }}
              className="text-xs font-semibold text-gray-500 px-3 py-2 rounded-xl hover:bg-gray-100">Cancel</button>
          )}
        </div>
        <p className="flex items-center gap-1 text-[10px] text-gray-400 pt-1">
          <ShieldCheck size={11} /> Your key is stored securely server-side, never shown on your store page.
        </p>
      </div>
    );
  }

  // ── Connected → broadcast bar ──
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
          <Check size={14} /> WhatsApp connected
        </span>
        <button onClick={() => { setEditing(true); setResult(null); }}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-gray-700">
          <Pencil size={11} /> Edit
        </button>
      </div>

      {result ? (
        <div className={`text-xs font-semibold ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>
          {result.ok
            ? `✅ Sent to ${result.sent} customer${result.sent === 1 ? '' : 's'}${result.failed ? ` · ${result.failed} failed` : ''}.`
            : `⚠️ ${result.error}`}
          <button onClick={() => setResult(null)} className="ml-2 underline text-gray-500 font-normal">Done</button>
        </div>
      ) : confirming ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            Send to <b>{audience.length}</b> {audienceLabel === 'all' ? '' : `${audienceLabel} `}customer{audience.length === 1 ? '' : 's'}?
            This uses your Seniqify credits (~₹0.25 utility / ₹1.09 marketing each).
          </p>
          <div className="flex items-center gap-2">
            <button onClick={send} disabled={sending}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-4 py-2 rounded-xl bg-emerald-600 active:scale-95 disabled:opacity-50">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />} Confirm send
            </button>
            <button onClick={() => setConfirming(false)} disabled={sending}
              className="text-xs font-semibold text-gray-500 px-3 py-2 rounded-xl hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} disabled={audience.length === 0}
          className="w-full inline-flex items-center justify-center gap-2 text-sm font-bold text-white py-2.5 rounded-xl bg-emerald-600 active:scale-95 disabled:opacity-40">
          <Megaphone size={15} /> Send to {audience.length} {audienceLabel === 'all' ? '' : `${audienceLabel} `}customer{audience.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-gray-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
}
