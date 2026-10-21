import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function output(name, value, file = process.env.GITHUB_OUTPUT) {
  if (!file) return;
  const delimiter = randomUUID();
  appendFileSync(file, `${name}<<${delimiter}\n${String(value)}\n${delimiter}\n`);
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function redact(text, token) {
  return token ? String(text).split(token).join('[REDACTED]') : String(text);
}
