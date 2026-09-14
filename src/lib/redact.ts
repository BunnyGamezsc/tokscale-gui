const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;

export type Part = { text: string; email: boolean };

/** `text` cut into runs, each email its own run, so a view can hide just those. */
export function splitEmails(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(EMAIL)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), email: false });
    parts.push({ text: m[0], email: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), email: false });
  return parts;
}

/** `rvaatp@gmail.com` as `r•••@g•••.com`: enough to tell two accounts apart. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local[0]}•••@${domain[0]}•••${domain.slice(domain.lastIndexOf("."))}`;
}
