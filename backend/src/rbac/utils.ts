export function normalizeRoleName(role: string): string {
  const trimmed = role.trim();
  if (!trimmed) {
    return '';
  }
  const lowered = trimmed.toLowerCase();
  const withoutPrefix = lowered.replace(/^role[_:\-]/, '');
  const segments = withoutPrefix.split(/[\/:]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : withoutPrefix;
}
