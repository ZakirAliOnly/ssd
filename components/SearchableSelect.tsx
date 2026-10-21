"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface Option {
  value: string;
  label: string;
  /** Human-readable name when value is a unique ID. */
  searchText?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  /** Maximum matches displayed after filtering the full option list. */
  maxResults?: number;
  /** Text shown in the "clear / all" row at the top of the list */
  placeholder?: string;
  /** Value emitted when the clear row is selected (default: "") */
  emptyValue?: string;
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
  /** When set, shows a "+ Add …" row when the typed query has no exact match.
   *  Receives the trimmed search query that the user typed. */
  onCreate?: (query: string) => void;
  /** Label prefix for the create row (default: "+ Add"). */
  createLabel?: string;
  /** Optional server search; existing local pickers retain their behavior. */
  onSearchChange?: (query: string) => void;
  onOpenChange?: (open: boolean) => void;
  remote?: boolean;
  loading?: boolean;
  loadError?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  maxResults,
  placeholder = "— Select —",
  emptyValue = "",
  inputClassName = "",
  inputStyle,
  onCreate,
  createLabel = "+ Add",
  onSearchChange,
  onOpenChange,
  remote = false,
  loading = false,
  loadError = "",
}: SearchableSelectProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";
  const isEmpty = value === emptyValue || value === "";

  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const matches = remote ? options : trimmedQuery
    ? options
        .filter((o) => `${o.searchText ?? o.value} ${o.label}`.toLowerCase().includes(normalizedQuery))
        .sort((a, b) => {
          const rank = (o: Option) => {
            const name = (o.searchText ?? o.value).toLowerCase();
            return name === normalizedQuery ? 0 : name.startsWith(normalizedQuery) ? 1 : 2;
          };
          return rank(a) - rank(b);
        })
    : options;
  const filtered = loading || loadError ? [] : maxResults === undefined ? matches : matches.slice(0, maxResults);
  const hasExactMatch = trimmedQuery
    ? options.some((o) => o.label.toLowerCase() === trimmedQuery.toLowerCase() || (o.searchText ?? o.value).toLowerCase() === trimmedQuery.toLowerCase())
    : false;
  const showCreateRow = !!onCreate && !loading && !loadError && trimmedQuery.length > 0 && !hasExactMatch;

  const updateOpen = useCallback((value: boolean) => { setOpen(value); onOpenChange?.(value); }, [onOpenChange]);
  const updateQuery = useCallback((value: string) => { setQuery(value); onSearchChange?.(value); }, [onSearchChange]);

  const positionDropdown = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const margin = 8;
    const desiredMax = 220;
    const spaceBelow = viewportH - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const flipUp = spaceBelow < Math.min(desiredMax, 160) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(desiredMax, flipUp ? spaceAbove : spaceBelow));
    setDropdownStyle(
      flipUp
        ? {
            position: "fixed",
            bottom: viewportH - rect.top + 4,
            left: rect.left,
            width: rect.width,
            maxHeight,
            zIndex: 9999,
          }
        : {
            position: "fixed",
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
            maxHeight,
            zIndex: 9999,
          }
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(positionDropdown);
    window.addEventListener("scroll", positionDropdown, true);
    window.addEventListener("resize", positionDropdown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", positionDropdown, true);
      window.removeEventListener("resize", positionDropdown);
    };
  }, [open, positionDropdown]);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (
        inputRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      updateOpen(false);
      updateQuery("");
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open, updateOpen, updateQuery]);

  function handleFocus() {
    updateOpen(true);
    updateQuery("");
    setHighlight(0);
  }

  function handleInput(e: React.FormEvent<HTMLInputElement>) {
    updateQuery(e.currentTarget.value);
    if (dropdownRef.current) dropdownRef.current.scrollTop = 0;
    updateOpen(true);
    setHighlight(0);
  }

  function select(opt: Option | null) {
    onChange(opt ? opt.value : emptyValue);
    updateOpen(false);
    updateQuery("");
    inputRef.current?.blur();
  }

  function handleCreate() {
    if (!onCreate || !trimmedQuery) return;
    onCreate(trimmedQuery);
    updateOpen(false);
    updateQuery("");
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        updateOpen(true);
        setHighlight(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (filtered.length === 0 ? 0 : (h + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (filtered.length === 0 ? 0 : (h - 1 + filtered.length) % filtered.length));
    } else if (e.key === "Enter") {
      if (filtered.length === 0) {
        if (showCreateRow) {
          e.preventDefault();
          handleCreate();
        }
        return;
      }
      e.preventDefault();
      const idx = Math.min(highlight, filtered.length - 1);
      select(filtered[idx]);
    } else if (e.key === "Escape") {
      updateOpen(false);
      updateQuery("");
      inputRef.current?.blur();
    }
  }

  const displayValue = open ? query : (isEmpty ? "" : selectedLabel);

  const dropdown = open ? (
    <div
      ref={dropdownRef}
      style={{
        background: "#fff",
        border: "1px solid var(--gray-200)",
        borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
        overflowY: "auto",
        ...dropdownStyle,
      }}
    >
      <div
        onMouseDown={(e) => { e.preventDefault(); select(null); }}
        className="px-3 py-2 text-[11px] cursor-pointer hover:bg-[var(--blue-pale)]"
        style={{ color: "var(--gray-500)", borderBottom: "1px solid var(--gray-100)" }}
      >
        {placeholder}
      </div>
      {filtered.length === 0 ? (
        <>
          <div className="px-3 py-2 text-[11px]" style={{ color: "var(--gray-400)" }}>
            {loading ? "Loading products…" : loadError || "No results"}
          </div>
          {showCreateRow && (
            <div
              onMouseDown={(e) => { e.preventDefault(); handleCreate(); }}
              className="px-3 py-2 text-[12px] cursor-pointer hover:bg-[var(--blue-pale)]"
              style={{ color: "var(--blue-deeper)", fontWeight: 700, borderTop: "1px solid var(--gray-100)" }}
            >
              {createLabel} &ldquo;{trimmedQuery}&rdquo;
            </div>
          )}
        </>
      ) : (
        <>
          {filtered.map((o, i) => {
            const isHighlighted = i === Math.min(highlight, filtered.length - 1);
            return (
              <div
                key={o.value}
                onMouseDown={(e) => { e.preventDefault(); select(o); }}
                onMouseEnter={() => setHighlight(i)}
                className="px-3 py-2 text-[12px] cursor-pointer"
                style={{
                  fontWeight: o.value === value ? 700 : 400,
                  color: o.value === value ? "var(--blue-deeper)" : "var(--gray-900)",
                  background: isHighlighted ? "var(--blue-pale)" : undefined,
                }}
              >
                {o.label}
              </div>
            );
          })}
          {showCreateRow && (
            <div
              onMouseDown={(e) => { e.preventDefault(); handleCreate(); }}
              className="px-3 py-2 text-[12px] cursor-pointer hover:bg-[var(--blue-pale)]"
              style={{ color: "var(--blue-deeper)", fontWeight: 700, borderTop: "1px solid var(--gray-100)" }}
            >
              {createLabel} &ldquo;{trimmedQuery}&rdquo;
            </div>
          )}
        </>
      )}
    </div>
  ) : null;

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        placeholder={isEmpty ? placeholder : selectedLabel}
        onFocus={handleFocus}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        className={inputClassName}
        style={inputStyle}
        autoComplete="off"
      />
      {typeof window !== "undefined" && dropdown
        ? createPortal(dropdown, document.body)
        : null}
    </div>
  );
}
