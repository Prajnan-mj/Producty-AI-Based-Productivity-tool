// Client-side convenience only — the real gate is server-side (require_admin).
// Keep this in sync with backend settings.ADMIN_EMAILS.
export const ADMIN_EMAILS = ["mj.prajnan@gmail.com"];

export function isAdmin(user) {
  if (!user?.email) return false;
  return ADMIN_EMAILS.includes(user.email.trim().toLowerCase());
}
