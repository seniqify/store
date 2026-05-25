// App-wide configuration constants

export const APP_CONFIG = {
  name: 'Seniqify Store',
  tagline: 'Your Trusted Online Store',
  currency: {
    symbol: '₹',
    code: 'INR',
    locale: 'en-IN',
  },
  business: {
    phone: '+91 98765 43210',
    email: 'support@seniqify.store',
    address: 'Mumbai, Maharashtra',
    gst: 'GST No: 27XXXXX1234Z1Z5',
    upi: 'seniqify@upi',
  },
  cart: {
    taxRate: 0.18, // 18% GST
    freeShippingAbove: 999,
    shippingCharge: 49,
  },
  pagination: {
    productsPerPage: 12,
  },
};

export const PAYMENT_MODES = ['UPI', 'Cash on Delivery', 'Bank Transfer', 'Card'];

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Puducherry',
];
