import {
  Database, Workflow, Server, Share2, Cookie, KeyRound, ShieldCheck, RefreshCw,
} from 'lucide-react';
import LegalPage, { Bullets, Callout } from '../components/legal/LegalPage';

const LAST_UPDATED = 'June 2026';

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
          We never sell your data, rent it, or use it for third-party advertising.
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
        do not share your data with advertisers, analytics brokers or data resellers.
      </p>
    ),
  },
  {
    id: 'cookies', title: 'Cookies & local storage', icon: Cookie,
    content: (
      <p>
        We use your browser's local storage to cache your store configuration for faster loads. We do
        not use third-party tracking cookies or ad pixels.
      </p>
    ),
  },
  {
    id: 'rights', title: 'Your rights & control', icon: KeyRound,
    content: (
      <Bullets items={[
        <><strong>Delete your store:</strong> permanently remove your store and its data from the Settings tab in your dashboard.</>,
        <><strong>Update your data:</strong> edit any of your store details anytime from the dashboard.</>,
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
      summary="We collect only what's needed to run your store. We never sell your data or use it for advertising. Customer order details are passed to the shop, not stored by us. You can delete your store and its data anytime."
      sections={SECTIONS}
      other={{ to: '/terms', label: 'Terms of Service' }}
    />
  );
}
