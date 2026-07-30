/**
 * Validate Indian mobile number (10 digits, starts with 6-9)
 */
export function isValidPhone(phone) {
  return /^[6-9]\d{9}$/.test(phone.replace(/\s|-/g, ''));
}

/**
 * Validate Indian PIN code (6 digits)
 */
export function isValidPinCode(pin) {
  return /^[1-9][0-9]{5}$/.test(pin);
}

/**
 * Validate email address
 */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate customer form fields
 * Returns { isValid: boolean, errors: { fieldName: string } }
 */
export function validateCustomerForm(form) {
  const errors = {};

  if (!form.name || form.name.trim().length < 2) {
    errors.name = 'Full name must be at least 2 characters';
  }

  if (!form.phone || !isValidPhone(form.phone)) {
    errors.phone = 'Enter a valid 10-digit mobile number';
  }

  if (form.email && !isValidEmail(form.email)) {
    errors.email = 'Enter a valid email address';
  }

  if (!form.address || form.address.trim().length < 10) {
    errors.address = 'Please enter your full delivery address';
  }

  if (!form.city || form.city.trim().length < 2) {
    errors.city = 'Enter your city name';
  }

  if (!form.state) {
    errors.state = 'Please select your state';
  }

  if (!form.pincode || !isValidPinCode(form.pincode)) {
    errors.pincode = 'Enter a valid 6-digit PIN code';
  }

  if (!form.paymentMode) {
    errors.paymentMode = 'Please select a payment method';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validate the CustomerDetailsForm (B2B order form).
 * Required: partyName, mobile, destination (city), paymentMethod.
 * For home delivery (requireDeliveryAddress), also require the full street
 * address + a valid 6-digit PIN so the order can produce a real delivery slip.
 * Pickup orders skip the address fields.
 * Optional: notes.
 *
 * Returns { isValid: boolean, errors: { fieldName: string } }
 */
export function validateCustomerDetails(form, { requireDeliveryAddress = false } = {}) {
  const errors = {};

  if (!form.partyName || form.partyName.trim().length < 2) {
    errors.partyName = 'Party name must be at least 2 characters';
  }

  if (!form.mobile || !isValidPhone(form.mobile)) {
    errors.mobile = 'Enter a valid 10-digit mobile number';
  }

  if (requireDeliveryAddress) {
    if (!form.addressLine || form.addressLine.trim().length < 5) {
      errors.addressLine = 'Enter the full delivery address (house / street / area)';
    }
    if (!form.pincode || !isValidPinCode(form.pincode)) {
      errors.pincode = 'Enter a valid 6-digit PIN code';
    }
  }

  if (!form.destination || form.destination.trim().length < 2) {
    errors.destination = requireDeliveryAddress ? 'Enter the city / town' : 'Enter the delivery destination';
  }

  if (!form.paymentMethod) {
    errors.paymentMethod = 'Please select a payment method';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
