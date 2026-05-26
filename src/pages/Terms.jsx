import { Link } from 'react-router-dom';

const LAST_UPDATED = 'May 2025';

export default function Terms() {
  return (
    <div className="min-h-screen bg-white">

      {/* Nav */}
      <nav className="border-b border-gray-100 bg-white/90 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/pocketlink-logo.png" alt="PocketLink" className="h-36 w-auto" />
          </Link>
          <span className="text-gray-300">·</span>
          <span className="text-sm text-gray-500">Terms of Service</span>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: {LAST_UPDATED}</p>

        <div className="prose prose-sm prose-gray max-w-none space-y-8 text-gray-700">

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using PocketLink ("the Platform"), you agree to be bound by these Terms
              of Service. If you do not agree, please do not use the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">2. Description of Service</h2>
            <p>
              PocketLink allows Indian businesses to create a storefront page and receive product
              orders via WhatsApp. We do not process payments, hold inventory, or act as a party
              in any transaction between a store owner and their customers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">3. Store Owner Responsibilities</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>You are solely responsible for the accuracy of your store's content.</li>
              <li>You must comply with all applicable Indian laws and GST regulations.</li>
              <li>You must not list prohibited or illegal products.</li>
              <li>You are responsible for fulfilling orders placed through your store.</li>
              <li>Keep your store management PIN confidential.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">4. Prohibited Uses</h2>
            <p>You may not use the Platform to:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Sell counterfeit, illegal, or harmful products.</li>
              <li>Spam, deceive, or defraud customers.</li>
              <li>Attempt to hack, overload, or reverse-engineer the Platform.</li>
              <li>Create stores with misleading brand names or impersonate others.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">5. Intellectual Property</h2>
            <p>
              The PocketLink brand, logo, and Platform code are owned by us. Store owners retain
              ownership of the content they upload (product names, images, descriptions).
              By uploading content you grant us a non-exclusive licence to host and display it
              on the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">6. Disclaimer of Warranties</h2>
            <p>
              The Platform is provided "as is" without any warranty. We do not guarantee
              uninterrupted availability, and we are not liable for any loss of orders,
              revenue, or data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">7. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, PocketLink shall not be liable for any
              indirect, incidental, or consequential damages arising from your use of the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">8. Termination</h2>
            <p>
              We reserve the right to suspend or terminate any store that violates these Terms,
              with or without notice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">9. Governing Law</h2>
            <p>
              These Terms are governed by the laws of India. Any disputes shall be subject to
              the exclusive jurisdiction of the courts in India.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">10. Contact</h2>
            <p>
              For questions about these Terms, contact us at{' '}
              <a href="mailto:hello@pocketlink.store" className="text-teal-600 hover:underline">
                hello@pocketlink.store
              </a>.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-gray-100 px-4 py-6 text-center text-xs text-gray-400">
        <Link to="/" className="hover:text-gray-700 transition-colors">← Back to PocketLink</Link>
        <span className="mx-3">·</span>
        <Link to="/privacy" className="hover:text-gray-700 transition-colors">Privacy Policy</Link>
      </footer>
    </div>
  );
}
