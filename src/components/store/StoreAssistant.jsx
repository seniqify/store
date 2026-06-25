import { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Send, MessageCircle } from 'lucide-react';

/**
 * StoreAssistant — a customer-facing AI chat for the storefront.
 *
 * A floating button opens a chat panel; questions go to /api/ai-chat, which
 * answers grounded in this store's own catalogue. Premium-only — the caller
 * (Home) gates rendering on the plan, and the API gates again server-side.
 */
export default function StoreAssistant({ slug, businessName, themeColor = '#0d9488', logoEmoji = '🏪', waLink }) {
  const greeting = {
    role: 'assistant',
    content: `Hi! 👋 I'm ${businessName}'s assistant. Ask me about products, prices or availability.`,
  };

  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState([greeting]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const scrollRef = useRef(null);

  // Keep the latest message in view as the conversation grows / typing shows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading, open]);

  async function send(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      const r = await fetch('/api/ai-chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Drop the local greeting so the payload starts from the customer's turn.
        body: JSON.stringify({ slug, messages: next.slice(1) }),
      });
      const data = await r.json().catch(() => ({}));
      const reply = data?.reply
        || "Sorry, I'm having trouble right now — please tap “Order on WhatsApp” and the shop will help you directly.";
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch {
      setMessages((m) => [...m, {
        role: 'assistant',
        content: "Sorry, I'm having trouble right now — please tap “Order on WhatsApp” and the shop will help you directly.",
      }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Floating launcher (sits above the mobile tab bar) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask the shop assistant"
          className="fixed right-4 bottom-24 lg:bottom-6 z-40 inline-flex items-center gap-2 pl-3 pr-4 py-3
                     rounded-full text-white font-bold text-sm shadow-xl active:scale-95 transition-transform"
          style={{ backgroundColor: themeColor, boxShadow: `0 12px 30px ${themeColor}55` }}
        >
          <span className="relative flex items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white/40 animate-ping" />
            <Sparkles size={16} className="relative" />
          </span>
          Ask us
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed right-3 left-3 sm:left-auto bottom-24 lg:bottom-6 sm:right-6 z-50 sm:w-[370px]
                        max-h-[72vh] flex flex-col rounded-3xl bg-white border border-gray-100 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 text-white" style={{ backgroundColor: themeColor }}>
            <span className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-base flex-shrink-0">
              {logoEmoji}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm leading-tight truncate">{businessName} assistant</p>
              <p className="text-[11px] text-white/80 leading-tight inline-flex items-center gap-1">
                <Sparkles size={10} /> Instant answers
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/15 active:scale-95">
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5 bg-[#f8fafc]">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={[
                    'max-w-[82%] px-3.5 py-2 rounded-2xl text-[13px] leading-snug whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'text-white rounded-br-md'
                      : 'bg-white text-gray-700 border border-gray-100 rounded-bl-md shadow-sm',
                  ].join(' ')}
                  style={m.role === 'user' ? { backgroundColor: themeColor } : undefined}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-md shadow-sm px-3.5 py-2.5">
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* WhatsApp fallback */}
          {waLink && (
            <a href={waLink} target="_blank" rel="noopener noreferrer"
               className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#1ebe5d] bg-emerald-50/60
                          border-t border-gray-100 py-1.5 hover:bg-emerald-50 transition-colors">
              <MessageCircle size={12} /> Prefer to chat? Order on WhatsApp
            </a>
          )}

          {/* Input */}
          <form onSubmit={send} className="flex items-center gap-2 p-2.5 border-t border-gray-100 bg-white">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything…"
              maxLength={500}
              className="flex-1 px-3.5 py-2.5 rounded-full bg-gray-100 text-sm text-gray-900 placeholder-gray-400
                         focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
            <button type="submit" disabled={!input.trim() || loading} aria-label="Send"
              className="w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0
                         disabled:opacity-40 active:scale-95 transition-transform"
              style={{ backgroundColor: themeColor }}>
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
