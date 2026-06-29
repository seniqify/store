import {
  FileCheck, Store, ClipboardCheck, Ban, CreditCard, Copyright,
  ShieldAlert, Scale, Power, RefreshCw, Landmark,
} from 'lucide-react';
import LegalPage, { Bullets, Callout } from '../components/legal/LegalPage';

const LAST_UPDATED = 'June 2026';

const SECTIONS = [
  {
    id: 'acceptance', title: 'Acceptance of terms', icon: FileCheck,
    content: (
      <p>
        By accessing or using PocketLink (“the Platform”), you agree to be bound by these Terms of
        Service and our <a href="/privacy">Privacy Policy</a>. If you do not agree, please do not use
        the Platform.
      </p>
    ),
  },
  {
    id: 'what', title: 'What PocketLink is', icon: Store,
    content: (
      <>
        <p>
          PocketLink lets Indian businesses create an online storefront and receive orders over
          WhatsApp. There are two separate money flows — and the difference matters:
        </p>
        <Bullets items={[
          <><strong>Subscription fees</strong> — what you (the business owner) pay PocketLink for a paid plan, handled by our payment partner, Razorpay.</>,
          <><strong>Customer orders</strong> — what a shopper pays your shop. PocketLink is <strong>not a party</strong> to these; we do not process, hold or refund money between you and your customers.</>,
        ]} />
      </>
    ),
  },
  {
    id: 'responsibilities', title: 'Your responsibilities', icon: ClipboardCheck,
    content: (
      <Bullets items={[
        'You are solely responsible for the accuracy of your storefront content, prices and stock.',
        'You must comply with all applicable Indian laws and GST regulations.',
        'You must not list prohibited, counterfeit or illegal products.',
        'You are responsible for fulfilling, delivering and supporting every order placed through your page.',
        'Keep your management PIN confidential — anyone with it can edit your store.',
      ]} />
    ),
  },
  {
    id: 'prohibited', title: 'Prohibited uses', icon: Ban,
    content: (
      <>
        <p>You may not use the Platform to:</p>
        <Bullets items={[
          'Sell counterfeit, illegal, unsafe or restricted products.',
          'Spam, deceive, scam or defraud customers.',
          'Impersonate another business or use misleading brand names.',
          'Hack, overload, scrape or reverse-engineer the Platform.',
        ]} />
      </>
    ),
  },
  {
    id: 'billing', title: 'Subscriptions, billing & refunds', icon: CreditCard,
    content: (
      <>
        <p>PocketLink offers paid plans billed in advance for the chosen period (monthly or yearly) through Razorpay. By subscribing, you agree that:</p>
        <Bullets items={[
          'Fees are charged upfront at the start of each billing period.',
          'Cancelling stops future renewals only — your plan stays active until the end of the period you already paid for.',
          'Plan features and pricing may change; we’ll give notice of any increase before it applies to you.',
        ]} />
        <Callout tone="rose" title="No-refund policy">
          <p>
            <strong>All payments and subscription fees are final and non-refundable under any
            circumstances.</strong> This includes (without limitation) unused time, partial billing
            periods, plan downgrades, voluntary cancellation, lack of use, or suspension/termination
            of your account for a breach of these Terms. No refunds, credits or pro-rated returns
            will be issued.
          </p>
        </Callout>
        <p className="text-[13px] text-gray-400">
          Refunds for any product or service a customer buys from a shop are solely between that
          customer and the shop — PocketLink is not involved.
        </p>
      </>
    ),
  },
  {
    id: 'ip', title: 'Intellectual property', icon: Copyright,
    content: (
      <p>
        The PocketLink name, logo and Platform code are owned by us. You retain ownership of the
        content you upload (product names, images, descriptions). By uploading it, you grant us a
        non-exclusive licence to host and display it on the Platform so your store can function.
      </p>
    ),
  },
  {
    id: 'as-is', title: 'Service provided “as is”', icon: ShieldAlert,
    content: (
      <p>
        The Platform is provided “as is” and “as available”, without warranties of any kind. We do
        not guarantee uninterrupted or error-free availability, and we are not liable for any loss of
        orders, revenue, data or goodwill arising from downtime or bugs.
      </p>
    ),
  },
  {
    id: 'liability', title: 'Limitation of liability', icon: Scale,
    content: (
      <p>
        To the maximum extent permitted by law, PocketLink shall not be liable for any indirect,
        incidental, special or consequential damages arising from your use of the Platform. Where
        liability cannot be excluded, it is limited to the amount you paid us in the three months
        before the claim.
      </p>
    ),
  },
  {
    id: 'termination', title: 'Suspension & termination', icon: Power,
    content: (
      <p>
        We may suspend or terminate any store that violates these Terms, with or without notice. As
        stated above, suspension or termination for a breach does not entitle you to any refund.
      </p>
    ),
  },
  {
    id: 'changes', title: 'Changes to these terms', icon: RefreshCw,
    content: (
      <p>
        We may update these Terms from time to time. Continued use of the Platform after an update
        means you accept the revised Terms. The “last updated” date above always reflects the current
        version.
      </p>
    ),
  },
  {
    id: 'law', title: 'Governing law', icon: Landmark,
    content: (
      <p>
        These Terms are governed by the laws of India. Any disputes are subject to the exclusive
        jurisdiction of the courts of India.
      </p>
    ),
  },
];

export default function Terms() {
  return (
    <LegalPage
      kicker="Legal"
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      intro="These terms govern your use of PocketLink. We've kept them in plain language so you actually know what you're agreeing to."
      summary="PocketLink gives Indian businesses a WhatsApp storefront. You run your shop; we provide the software. Paid plans are billed in advance and are non-refundable. You're responsible for your products, orders and following the law."
      sections={SECTIONS}
      other={{ to: '/privacy', label: 'Privacy Policy' }}
    />
  );
}
