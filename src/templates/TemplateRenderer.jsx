import { lazy, Suspense } from 'react';
import { useBusinessConfig } from '../contexts/BusinessContext';
import ProductTemplate from '../pages/Home';

// Lazy-load non-product templates — only downloaded when needed
const ServiceTemplate    = lazy(() => import('./ServiceTemplate'));

const TEMPLATES = {
  product: ProductTemplate,
  service: ServiceTemplate,
};

function TemplateFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-700 rounded-full animate-spin" />
    </div>
  );
}

/**
 * TemplateRenderer — reads businessType from BusinessContext and renders
 * the matching template. Defaults to ProductTemplate for legacy stores
 * that don't have a businessType set.
 */
export default function TemplateRenderer(props) {
  const config       = useBusinessConfig();
  const businessType = config.businessType ?? 'product';
  const Template     = TEMPLATES[businessType] ?? ProductTemplate;

  return (
    <Suspense fallback={<TemplateFallback />}>
      <Template {...props} />
    </Suspense>
  );
}
