import {
  Trash2, Unplug, Mail, ListChecks, LogIn, Clock,
} from 'lucide-react';
import LegalPage, { Bullets, Callout } from '../components/legal/LegalPage';

const LAST_UPDATED = 'September 2026';

const SECTIONS = [
  {
    id: 'self-serve', title: 'Delete it yourself (fastest)', icon: Trash2,
    content: (
      <>
        <p>You can remove your data directly from your PocketLink dashboard at any time:</p>
        <Bullets items={[
          <><strong>Delete your store:</strong> open your dashboard → <strong>Settings</strong> → <strong>Delete store</strong>. This permanently removes your store, its products, orders and settings from our systems.</>,
          <><strong>Disconnect Meta:</strong> in your dashboard, open the <strong>Meta</strong> card and choose <strong>Disconnect</strong>. This deletes the Meta access token and connected assets we stored, and stops any further data being shared with Meta.</>,
        ]} />
        <p className="text-[13px] text-gray-400">
          Deleting your store also removes the Meta connection associated with it.
        </p>
      </>
    ),
  },
  {
    id: 'meta', title: 'Data you shared through Facebook Login', icon: LogIn,
    content: (
      <>
        <p>
          If you connected your Meta (Facebook/Instagram) account to PocketLink, we stored a Meta
          access token and references to the business assets you granted (your Pages, ad accounts and
          Pixel). To delete this specific data:
        </p>
        <Bullets items={[
          <>Use <strong>Disconnect Meta</strong> in your dashboard (above), <strong>or</strong></>,
          <>Remove PocketLink from your Facebook settings: <strong>Facebook → Settings &amp; privacy → Settings → Apps and Websites</strong>, select <strong>PocketLink</strong>, and choose <strong>Remove</strong>.</>,
        ]} />
        <p>
          Either action revokes our access. Any event data already sent to Meta for ad measurement is
          held by Meta under Meta's own data policy — you can manage or delete that from your Facebook
          account's activity and ad settings.
        </p>
      </>
    ),
  },
  {
    id: 'email', title: 'Request deletion by email', icon: Mail,
    content: (
      <>
        <p>
          Prefer we handle it, or can't access your dashboard? Email us and we'll delete your data for
          you:
        </p>
        <Callout tone="emerald" title="Send a request">
          <p>
            Email <a href="mailto:hello@pocketlink.store?subject=Data%20deletion%20request">hello@pocketlink.store</a> with
            the subject <strong>“Data deletion request”</strong>. Include your store name or link so we
            can find your account. We may ask you to verify ownership before deleting.
          </p>
        </Callout>
      </>
    ),
  },
  {
    id: 'scope', title: 'What gets deleted', icon: ListChecks,
    content: (
      <Bullets items={[
        'Your store configuration — business details, products, pricing and settings.',
        'Your orders and customer list held for your store.',
        'Any Meta access token and connected Page / ad account / Pixel references we stored.',
        'Uploaded images in our cloud storage.',
      ]} />
    ),
  },
  {
    id: 'timeline', title: 'How long it takes', icon: Clock,
    content: (
      <p>
        Self-service deletions take effect immediately. Email requests are actioned within
        <strong> 30 days</strong> of us verifying your request. Some information may remain in encrypted
        backups for a limited period before those backups are rotated out, and we may retain the
        minimum records required by law (for example, tax or payment records) — these are never used
        for any other purpose.
      </p>
    ),
  },
  {
    id: 'revoke', title: 'Revoking access without deleting', icon: Unplug,
    content: (
      <p>
        If you only want to stop PocketLink from accessing your Meta account — but keep your store —
        use <strong>Disconnect Meta</strong> in your dashboard. Your store keeps working; we simply lose
        access to your Facebook/Instagram assets and stop sharing any data with Meta.
      </p>
    ),
  },
];

export default function DataDeletion() {
  return (
    <LegalPage
      kicker="Legal"
      title="Data Deletion"
      lastUpdated={LAST_UPDATED}
      intro="How to delete the data PocketLink holds for you — including anything connected through Facebook Login — either yourself in seconds, or by asking us."
      summary="Delete your store from Settings, or disconnect Meta from your dashboard, to remove your data instantly. You can also email hello@pocketlink.store with the subject “Data deletion request” and we'll do it within 30 days."
      sections={SECTIONS}
      other={{ to: '/privacy', label: 'Privacy Policy' }}
    />
  );
}
