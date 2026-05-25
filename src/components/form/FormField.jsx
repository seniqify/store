/**
 * Reusable form field wrapper with label and error message
 */
export default function FormField({ label, required, error, children, hint }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
      {error && <p className="text-xs text-red-500 flex items-center gap-1">⚠ {error}</p>}
    </div>
  );
}

/**
 * Styled text input
 */
export function TextInput({ error, ...props }) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900 placeholder-gray-400
                  transition focus:outline-none focus:ring-2
                  ${error
                    ? 'border-red-400 focus:ring-red-300 bg-red-50'
                    : 'border-gray-200 focus:ring-brand focus:border-transparent bg-white'
                  }
                  ${props.disabled ? 'bg-gray-50 cursor-not-allowed' : ''}`}
    />
  );
}

/**
 * Styled textarea
 */
export function TextArea({ error, ...props }) {
  return (
    <textarea
      {...props}
      rows={props.rows || 3}
      className={`w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900 placeholder-gray-400
                  transition focus:outline-none focus:ring-2 resize-none
                  ${error
                    ? 'border-red-400 focus:ring-red-300 bg-red-50'
                    : 'border-gray-200 focus:ring-brand focus:border-transparent bg-white'
                  }`}
    />
  );
}

/**
 * Styled select dropdown
 */
export function SelectInput({ error, children, ...props }) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900 bg-white
                  transition focus:outline-none focus:ring-2 cursor-pointer
                  ${error
                    ? 'border-red-400 focus:ring-red-300'
                    : 'border-gray-200 focus:ring-brand focus:border-transparent'
                  }`}
    >
      {children}
    </select>
  );
}
