import {
  Database, Workflow, Server, Share2, Cookie, KeyRound, ShieldCheck, RefreshCw, Megaphone,
} from 'lucide-react';
import LegalPage, { Bullets, Callout } from '../components/legal/LegalPage';

const LAST_UPDATED = 'September 2026';

const SECTIONS = [
  {
    id: 'collect', title: 'What we collect', icon: Database,
    content: (
      <>
        <p><strong>Business owners</strong> provide:</p>
        <Bullets items={[
          'Business name, WhatsApp number and the details entered during onboarding.',
          'Product images, uploaded to our cloud storage.',
          <>A <strong>hashed</strong> management PIN — we never store your raw PIN.</>,
        ]} />
        <p className="pt-1"><strong>Customers</strong> who place an order provide:</p>
        <Bullets items={[
          'Name, mobile number, delivery destination and payment preference.',
          'These details are sent straight to the business owner over WhatsApp to fulfil the order.',
        ]} />
      </>
    ),
  },
  {
    id: 'use', title: 'How we use your data', icon: Workflow,
    content: (
      <>
        <Bullets items={[
          'To create, host and serve your storefront.',
          'To deliver orders to your WhatsApp and, for connected stores, to send messages you choose to send to your own customers.',
          'To authenticate access to your dashboard (via your PIN).',
        ]} />
        <Callout tone="emerald" title="What we never do">
          We never sell or rent your data. We use it to run your store — and, only if you choose to
          connect Meta, to create and measure the ads you ask us to run for you.
        </Callout>
      </>
    ),
  },
  {
    id: 'storage', title: 'Where your data is stored', icon: Server,
    content: (
      <p>
        Store configuration (business details, products, pricing, orders) is stored in a Supabase
        PostgreSQL database, and images in Supabase Object Storage — both hosted on AWS
        infrastructure. All traffic between your browser and our servers is encrypted over HTTPS.
      </p>
    ),
  },
  {
    id: 'sharing', title: 'Who we share it with', icon: Share2,
    content: (
      <p>
        We only share data with the infrastructure providers needed to run the service (e.g. Supabase
        for the database and storage, and our WhatsApp/messaging partner when you send messages). We
        never sell your data to advertisers, analytics brokers or data resellers. If you connect Meta
        to run ads, we share the specific data described in the “Advertising &amp; Meta” section below
        with Meta to operate and measure those ads — and nothing more.
      </p>
    ),
  },
  {
    id: 'ads', title: 'Advertising & Meta (Facebook/Instagram)', icon: Megaphone,
    content: (
      <>
        <p>
          Running ads is <strong>optional</strong>. This section applies only if a store owner chooses
          to connect their Meta (Facebook/Instagram) account to PocketLink. If you never connect Meta,
          none of this applies to you.
        </p>
        <p className="pt-1"><strong>When you connect Meta, you grant us access to:</strong></p>
        <Bullets items={[
          <>Your <strong>Facebook Pages</strong> and basic page details, so an ad can run under your page.</>,
          <>Your <strong>ad accounts and business assets</strong>, so we can create, manage and read the performance of the campaigns you ask us to run.</>,
          <>Your <strong>Meta Pixel</strong>, so store activity can be measured against your ads.</>,
        ]} />
        <p className="pt-1"><strong>What we send to Meta:</strong></p>
        <Bullets items={[
          'Storefront events (page views, add-to-cart, checkout, purchases) via the Meta Pixel and Conversions API, so you can see whether your ads led to sales.',
          <>To match those events to people, a <strong>hashed</strong> (irreversible SHA-256) version of a customer’s phone or email may be sent to Meta. We never send raw contact details for this purpose.</>,
        ]} />
        <Callout tone="emerald" title="Your control">
          <p>
            Your Meta access token is stored securely on our servers and is <strong>never</strong> exposed
            in your browser. You can <strong>disconnect Meta at any time</strong> from your dashboard, which
            stops all further access and event sharing. Our use of Meta data follows the Meta Platform Terms
            and Developer Policies.
          </p>
        </Callout>
      </>
    ),
  },
  {
    id: 'cookies', title: 'Cookies & local storage', icon: Cookie,
    content: (
      <>
        <p>
          We use your browser's local storage to cache your store configuration for faster loads. By
          default we do not use third-party tracking cookies.
        </p>
        <p>
          If a store owner connects Meta and enables the Meta Pixel, that store's pages load Meta's
          Pixel so ad performance can be measured — see the “Advertising &amp; Meta” section. Stores
          that don't use Meta ads load no ad pixels at all.
        </p>
      </>
    ),
  },
  {
    id: 'rights', title: 'Your rights & control', icon: KeyRound,
    content: (
      <Bullets items={[
        <><strong>Delete your store:</strong> permanently remove your store and its data from the Settings tab in your dashboard.</>,
        <><strong>Disconnect Meta:</strong> revoke our access to your Facebook/Instagram assets at any time from your dashboard.</>,
        <><strong>Update your data:</strong> edit any of your store details anytime from the dashboard.</>,
        <><strong>Delete your data:</strong> see our <a href="/data-deletion">Data Deletion</a> page for how to remove your data, including data shared with Meta.</>,
        <><strong>Export your data:</strong> contact us to request a copy of the data we hold for you.</>,
      ]} />
    ),
  },
  {
    id: 'security', title: 'Security', icon: ShieldCheck,
    content: (
      <p>
        Management PINs are hashed before storage — we never keep raw PINs. Owner-only data (such as
        your customer list and any saved messaging keys) is protected server-side and is never
        exposed on your public store page. All traffic is encrypted over HTTPS.
      </p>
    ),
  },
  {
    id: 'changes', title: 'Changes to this policy', icon: RefreshCw,
    content: (
      <p>
        We may update this policy from time to time. Continued use of the Platform after an update
        means you accept the revised policy. The “last updated” date above always reflects the current
        version.
      </p>
    ),
  },
];

export default function Privacy() {
  return (
    <LegalPage
      kicker="Legal"
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      intro="This explains what we collect, why, and what we never do with your data. No jargon, no surprises."
      summary="We collect only what's needed to run your store, and we never sell your data. Advertising is optional: only if you connect Meta do we create and measure ads for you, sharing hashed event data with Meta. You can disconnect Meta or delete your store and its data anytime."
      sections={SECTIONS}
      other={{ to: '/terms', label: 'Terms of Service' }}
    />
  );
}
