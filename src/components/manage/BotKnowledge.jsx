import { useState, useMemo } from 'react';
import { Bot, Download, Copy, Check, Eye, EyeOff, FileText, RefreshCw } from 'lucide-react';
import { buildKnowledgeDoc, downloadKnowledgeDoc, knowledgeSummary, knowledgeFilename } from '../../utils/botKnowledge';

/**
 * BotKnowledge — "WhatsApp AI Knowledge" generator inside AI Insights.
 *
 * Builds a downloadable, AI-friendly plain-text document from the store's live
 * products + info, which the seller uploads into Meta / WhatsApp Business AI so
 * their bot can answer customer questions accurately. Regenerate any time —
 * always reflects the current catalogue. (Direct Meta-API sync is a future step;
 * this is the download-and-upload version, built on the same doc builder.)
 */
export default function BotKnowledge({ config = {}, themeColor = '#0d9488' }) {
  const [preview, setPreview] = useState(false);
  const [copied, setCopied]   = useState(false);
  const [doc, setDoc]         = useState('');

  const summary = useMemo(() => knowledgeSummary(config), [config]);
  const hasProducts = summary.products > 0;

  function ensureDoc() {
    const text = buildKnowledgeDoc(config);
    setDoc(text);
    return text;
  }

  function handleDownload() { downloadKnowledgeDoc(config); }

  async function handleCopy() {
    const text = doc || ensureDoc();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the download always works */ }
  }

  function togglePreview() {
    if (!preview) ensureDoc();
    setPreview((v) => !v);
  }

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3" style={{ background: `linear-gradient(135deg, ${themeColor}12, transparent)` }}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl grid place-items-center text-white flex-shrink-0 shadow-sm" style={{ backgroundColor: themeColor }}>
            <Bot size={20} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-extrabold text-gray-900">Bot Knowledge</h3>
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md"
                    style={{ color: themeColor, background: `${themeColor}18` }}>for WhatsApp AI</span>
            </div>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Turn your store &amp; products into a knowledge file, then upload it into
              <strong className="text-gray-700"> Meta / WhatsApp Business AI</strong> so your bot answers
              customers with the right prices, details and links.
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        {!hasProducts ? (
          <p className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3.5 py-3">
            Add products to your store first — the knowledge file is built from your catalogue.
          </p>
        ) : (
          <>
            {/* Quality summary */}
            <div className="flex flex-wrap gap-2 mb-3">
              <Chip themeColor={themeColor}>{summary.products} product{summary.products === 1 ? '' : 's'}</Chip>
              <Chip themeColor={themeColor}>{summary.withImage} with image{summary.withImage === 1 ? '' : 's'}</Chip>
              {summary.missingDescription > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                  {summary.missingDescription} missing a description
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={handleDownload}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-white px-4 py-2.5 rounded-xl shadow-sm hover:opacity-90 active:scale-95 transition-all"
                style={{ backgroundColor: themeColor }}>
                <Download size={15} /> Download Word doc
              </button>
              <button type="button" onClick={handleCopy}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 border border-gray-200 px-3 py-2.5 rounded-xl hover:bg-gray-50 active:scale-95 transition">
                {copied ? <><Check size={14} className="text-green-600" /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
              <button type="button" onClick={togglePreview}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 border border-gray-200 px-3 py-2.5 rounded-xl hover:bg-gray-50 active:scale-95 transition">
                {preview ? <><EyeOff size={14} /> Hide</> : <><Eye size={14} /> Preview</>}
              </button>
            </div>

            <p className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-2.5">
              <FileText size={12} /> {knowledgeFilename(config)}
              <span className="text-gray-300">·</span>
              <RefreshCw size={11} /> Regenerate whenever your products change.
            </p>

            {/* Preview */}
            {preview && (
              <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-gray-200 bg-gray-900 text-gray-100 text-[11.5px] leading-relaxed p-3.5 whitespace-pre-wrap break-words font-mono">
                {doc}
              </pre>
            )}

            {/* How to use */}
            <div className="mt-3.5 rounded-xl border border-gray-100 bg-gray-50/70 px-3.5 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">How to use it</p>
              <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside marker:text-gray-400 marker:font-bold">
                <li>Tap <strong className="text-gray-800">Download Word doc</strong> to save the .docx file.</li>
                <li>In WhatsApp Business / Meta, open your AI assistant and go to <strong className="text-gray-800">Knowledge</strong>.</li>
                <li>Upload this Word document. Re-upload after you add or change products.</li>
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Chip({ children, themeColor }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
          style={{ color: themeColor, background: `${themeColor}14` }}>
      {children}
    </span>
  );
}
