/**
 * Cards the Orders and Delivery lists draw per "Show more" tap, as the
 * Abandoned tab does. A page size, never a cap: the counts and the search still
 * cover every order, and each one is a tap away. Drawing (and tearing down) a
 * thousand cards made every keystroke of the search lag on a phone.
 *
 * Its own module so the Delivery board can use it without importing the
 * Orders view.
 */
export const LIST_PAGE_SIZE = 50;
