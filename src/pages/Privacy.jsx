import { Link } from 'react-router-dom';

const LAST_UPDATED = 'May 2025';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white">

      {/* Nav */}
      <nav className="border-b border-gray-100 bg-white/90 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-72 w-auto" />
          </Link>
          <span className="text-gray-300">·</span>
          <span className="text-sm text-gray-500">Privacy Policy</span>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: {LAST_UPDATED}</p>

        <div className="prose prose-sm prose-gray max-w-none space-y-8 text-gray-700">

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">1. What We Collect</h2>
            <p><strong>Business owners</strong> provide:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Business name, WhatsApp number, and business details entered during onboarding.</li>
              <li>Product images (uploaded to our cloud storage).</li>
              <li>A hashed page management PIN (we never store your raw PIN).</li>
            </ul>
            <p className="mt-3"><strong>Customers</strong> who place orders provide:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Name, mobile number, delivery destination, and payment preference.</li>
              <li>This data is sent directly to the business owner via WhatsApp. We do not store it.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">2. How We Use Your Data</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>To create and serve your page.</li>
              <li>To send orders to your WhatsApp.</li>
              <li>To authenticate access to your dashboard (PIN).</li>
            </ul>
            <p className="mt-2">We do not sell your data or use it for advertising.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">3. Data Storage</h2>
            <p>
              Page configuration data (business name, products, pricing) is stored in a Supabase
              PostgreSQL database. Product images are stored in Supabase Object Storage.
              Both services are hosted on AWS infrastructure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">4. Data Sharing</h2>
            <p>
              We do not share your data with third parties except as required to operate the service
              (Supabase for database and storage). We do not share data with advertisers,
              analytics companies, or data brokers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">5. Cookies & Local Storage</h2>
            <p>
              We use browser localStorage to cache page configuration for faster page loads.
              We do not use third-party tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">6. Your Rights</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Delete your page:</strong> You can permanently delete your page and all
                associated data from the "Settings" tab in your dashboard.
              </li>
              <li>
                <strong>Update your data:</strong> Edit your page details anytime from the
                management dashboard.
              </li>
              <li>
                <strong>Data export:</strong> Contact us to request a copy of your stored data.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">7. Security</h2>
            <p>
              Page management PINs are hashed using SHA-256 before storage — we never store
              raw PINs. All communication between your browser and our servers uses HTTPS.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">8. Changes to This Policy</h2>
            <p>
              We may update this policy. Continued use of the Platform after changes constitutes
              acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">9. Contact</h2>
            <p>
              For privacy-related questions, email us at{' '}
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
        <Link to="/terms" className="hover:text-gray-700 transition-colors">Terms of Service</Link>
      </footer>
    </div>
  );
}
