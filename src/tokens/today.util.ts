/**
 * Returns midnight of the current server-local day. QueueDesk is deployed for
 * a single shop/clinic, so "today" is defined by the server's local timezone
 * rather than UTC — this must be used consistently everywhere "today" is
 * computed (token creation and the /tokens/today query) or token numbers
 * would roll over at the wrong local time.
 */
export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
