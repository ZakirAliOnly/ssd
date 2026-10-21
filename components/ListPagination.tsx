"use client";

export function ListPagination({ page, count, pageSize = 25, loading, onChange }: {
  page: number; count: number; pageSize?: number; loading: boolean; onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const button = "min-h-9 px-3 py-1.5 rounded-[9px] border border-[var(--gray-200)] text-xs font-semibold text-[var(--blue-deeper)] bg-white hover:bg-[var(--blue-pale)] focus-visible:outline-2 focus-visible:outline-[var(--blue)] disabled:opacity-50 disabled:cursor-not-allowed";
  return <nav aria-label="List pagination" className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-[var(--gray-100)]">
    <span role="status" className="text-xs text-[var(--gray-800)]">{count ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, count)} of ${count}` : "0 results"}</span>
    <div className="flex items-center gap-2">
      <button type="button" className={button} disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span className="text-xs text-[var(--gray-800)]">Page {page} of {pages}</span>
      <button type="button" className={button} disabled={loading || page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  </nav>;
}
