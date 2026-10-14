"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, FolderOpen, Monitor, CreditCard,
  FileText, Zap, LogOut, Package, BarChart2, Users, Receipt, RotateCcw,
} from "lucide-react";
import { db } from "@/lib/db";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/UserContext";

import { canAccessPath } from "@/lib/moduleAccess";

const navItems = [
  { label: "Overview", items: [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  ]},
  { label: "Finance", items: [
    { name: "Head Accounts", href: "/head-accounts", icon: FolderOpen },
    { name: "Accounts", href: "/accounts", icon: Monitor },
    { name: "Cash Book", href: "/cashbook", icon: CreditCard },
    { name: "Expense", href: "/expense", icon: Receipt },
  ]},
  { label: "Inventory", items: [
    { name: "Products", href: "/products", icon: Package },
  ]},
  { label: "Payroll", items: [
    { name: "Workers", href: "/workers", icon: Users },
  ]},
  { label: "Billing", items: [
    { name: "New Invoice", href: "/invoices", icon: FileText },
    { name: "Quick Invoice", href: "/quick-invoice", icon: Zap, badge: "NEW" },
    { name: "Invoice Report", href: "/invoice-report", icon: BarChart2 },
    { name: "Returns", href: "/returns", icon: RotateCcw },
  ]},
  { label: "Reports", items: [
    { name: "Reports", href: "/reports", icon: BarChart2 },
  ]},
];

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useUser();
  const isSubUser = profile?.role === "sub_user";

  const visibleNav = isSubUser
    ? navItems
        .map((s) => ({ ...s, items: s.items.filter((i) => canAccessPath(profile, i.href)) }))
        .filter((s) => s.items.length > 0)
    : navItems;

  async function handleLogout() {
    await db.auth.signOut();
    router.push("/");
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 bg-black/35 z-[140] lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`fixed top-[var(--header-h)] bottom-0 left-0 w-[var(--sidebar-w)] bg-white border-r border-[var(--gray-100)] overflow-y-auto flex flex-col z-[150] transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {visibleNav.map((section) => (
          <div key={section.label} className="px-2.5 pt-4 pb-1.5">
            <div className="text-[9px] font-bold tracking-[2.5px] uppercase px-2.5 mb-1"
              style={{ color: "var(--gray-300)" }}>
              {section.label}
            </div>
            {section.items.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href + item.name}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] mb-0.5 text-[13px] font-medium transition-all relative no-underline ${
                    isActive
                      ? "font-bold"
                      : "hover:bg-[var(--blue-pale)]"
                  }`}
                  style={{
                    background: isActive ? "var(--blue-light)" : undefined,
                    color: isActive ? "var(--blue-deeper)" : "var(--gray-500)",
                  }}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-md"
                      style={{ background: "var(--blue)" }} />
                  )}
                  <div className={`w-[30px] h-[30px] rounded-lg flex items-center justify-center shrink-0 transition-all`}
                    style={{
                      background: isActive ? "rgba(2,132,199,.15)" : undefined,
                    }}>
                    <Icon size={16} />
                  </div>
                  {item.name}
                  {item.badge && (
                    <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
                      style={{ background: "var(--green)" }}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="mt-auto p-2.5 border-t border-[var(--gray-100)]">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] w-full text-[13px] font-medium border-none bg-transparent cursor-pointer transition-all hover:bg-[var(--red-light)]"
            style={{ color: "var(--red)" }}
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
