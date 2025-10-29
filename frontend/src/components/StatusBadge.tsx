interface StatusBadgeProps {
  label: string;
  status: 'ok' | 'error' | 'loading';
  description?: string;
}

export function StatusBadge({ label, status, description }: StatusBadgeProps) {
  const palette: Record<StatusBadgeProps['status'], { wrapper: string; dot: string; text: string }> = {
    ok: {
      wrapper: 'border-emerald-400/40 bg-emerald-400/15',
      dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.8)]',
      text: 'text-emerald-200',
    },
    error: {
      wrapper: 'border-danger/40 bg-danger/15',
      dot: 'bg-danger shadow-[0_0_6px_rgba(248,113,113,0.8)]',
      text: 'text-danger',
    },
    loading: {
      wrapper: 'border-accent/40 bg-accent/10',
      dot: 'bg-accent shadow-[0_0_6px_rgba(96,165,250,0.8)]',
      text: 'text-accent',
    },
  };

  const colors = palette[status];

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${colors.wrapper} ${colors.text}`}
      title={description}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${colors.dot}`} />
      <span>{label}</span>
    </div>
  );
}
