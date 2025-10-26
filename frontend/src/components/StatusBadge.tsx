interface StatusBadgeProps {
  label: string;
  status: 'ok' | 'error' | 'loading';
  description?: string;
}

export function StatusBadge({ label, status, description }: StatusBadgeProps) {
  const colors = {
    ok: { background: 'rgba(34,197,94,0.2)', border: 'rgba(34,197,94,0.45)', text: '#bbf7d0' },
    error: { background: 'rgba(248,113,113,0.2)', border: 'rgba(248,113,113,0.4)', text: '#fecaca' },
    loading: { background: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.25)', text: '#bfdbfe' },
  }[status];

  return (
    <div
      className="status-badge"
      style={{
        background: colors.background,
        border: `1px solid ${colors.border}`,
        color: colors.text,
      }}
      title={description}
    >
      <span className="dot" data-status={status} />
      <span>{label}</span>
    </div>
  );
}

