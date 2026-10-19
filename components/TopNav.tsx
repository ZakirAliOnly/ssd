"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Monitor, FileText, LogOut,
  Package, BarChart2, Users, FileSignature, Truck, ClipboardList, History, UserCog, Receipt, RotateCcw, Menu, X, MessageCircle,
} from "lucide-react";
import { db } from "@/lib/db";
import { getInitials } from "@/lib/helpers";
import { canAccessPath, firstAllowedPath } from "@/lib/moduleAccess";
import { useUser } from "@/lib/UserContext";

// These live in the brand bar as text links
// adminOnly: true means the link is only shown to admin users
const menuBarLinks: { name: string; href: string; adminOnly?: true }[] = [
  { name: "Head Accounts", href: "/head-accounts" },
  { name: "Cash Book",     href: "/cashbook" },
  { name: "Invoice Report", href: "/invoice-report" },
  { name: "Quote",         href: "/quote" },
  { name: "Sub Users",     href: "/users", adminOnly: true },
  { name: "Payment Methods", href: "/payment-methods", adminOnly: true },
  { name: "WhatsApp Setup", href: "/whatsapp-setup", adminOnly: true },
  { name: "Change Password", href: "/change-password", adminOnly: true },
];

// Icon toolbar: order is intentional (Dashboard → … → Reports)
const adminToolbarItems: { name: string; href: string; icon: React.ElementType }[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Parties", href: "/accounts", icon: Monitor },
  { name: "Make Invoice Walk-In", href: "/quick-invoice", icon: FileText },
  { name: "Returns", href: "/returns", icon: RotateCcw },
  { name: "Expense", href: "/expense", icon: Receipt },
  { name: "Workers", href: "/workers", icon: Users },
  { name: "Products", href: "/products", icon: Package },
  { name: "Supplier", href: "/supplier", icon: Truck },
  { name: "Reports", href: "/reports", icon: BarChart2 },
  { name: "Quote", href: "/quote", icon: FileSignature },
  { name: "Delivery Challan", href: "/delivery-challan", icon: ClipboardList },
  { name: "Sub Users",       href: "/users",            icon: UserCog },
  { name: "Activity Log",    href: "/activity-log",     icon: History },
];


export default function TopNav() {
  const [email, setEmail] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const userProfile = useUser();

  useEffect(() => {
    db.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email || "User");
    });
  }, []);

  const today = new Date().toLocaleDateString("en-PK", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const isSubUser = userProfile?.role === "sub_user";
  const displayName = userProfile?.fullName || email.split("@")[0] || "User";
  const visibleMenuLinks = isSubUser
    ? menuBarLinks.filter(link => canAccessPath(userProfile, link.href))
    : menuBarLinks.filter((link) => !link.adminOnly || userProfile?.isAdmin);
  const toolbarItems = adminToolbarItems.filter(item => canAccessPath(userProfile, item.href));

  async function handleLogout() {
    await db.auth.signOut();
    router.push("/");
  }

  const mobileLinks = [...toolbarItems, ...visibleMenuLinks.filter(link => !toolbarItems.some(item => item.href === link.href))];

  return (
    <nav className="fixed top-0 left-0 right-0 z-[200] no-print" aria-label="Main navigation"
      onKeyDown={event => { if (event.key === "Escape") { setMenuOpen(false); document.getElementById("navigation-toggle")?.focus(); } }}>
      <div className="flex items-center justify-between px-3 sm:px-5 h-16 lg:h-12 gap-3 border-b border-[#86efac]" style={{ background: "var(--accent-sky)" }}>
        <Link href={userProfile ? firstAllowedPath(userProfile) : "/"} onClick={() => setMenuOpen(false)} className="flex items-center shrink-0 no-underline" title="Dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.svg" alt="S.S. Diagnostics" className="h-9 w-[145px] sm:w-[167px] object-contain" />
        </Link>
        <div className="hidden 2xl:flex items-stretch flex-1 min-w-0">
          {visibleMenuLinks.map(link => (
            <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}
              className="flex items-center px-2.5 h-12 text-xs font-semibold no-underline whitespace-nowrap hover:bg-white/40"
              style={{ color: "var(--blue-deeper)", background: pathname === link.href ? "rgba(3,105,161,0.10)" : undefined }}>
              {link.name}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="hidden min-[1800px]:block text-xs font-semibold whitespace-nowrap">{today}</span>
          <button onClick={handleLogout} title="Sign out" aria-label={`Sign out ${displayName}`}
            className="flex items-center gap-2 rounded-full p-1 sm:pr-2 hover:bg-white/40 cursor-pointer shrink-0">
            <span className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "var(--blue)" }}>{getInitials(displayName)}</span>
            <span className="hidden sm:block max-w-24 truncate text-xs">{displayName}</span>
            <LogOut size={15} className="hidden sm:block" />
          </button>
          <button id="navigation-toggle" type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(open => !open)}
            className="2xl:hidden flex items-center justify-center w-11 h-11 rounded-lg hover:bg-white/50 cursor-pointer">
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>
      <div className="hidden lg:flex bg-white border-b border-[var(--gray-200)] items-stretch overflow-x-auto nav-scrollbar-hide h-[106px] shadow-sm">
        {toolbarItems.map(item => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
            className="flex flex-col shrink-0 items-center justify-center gap-2 px-5 min-w-[100px] max-w-[132px] no-underline hover:bg-sky-50 border-r border-gray-200"
            style={{ background: active ? "var(--blue-light)" : undefined, color: "#0C2433" }}>
            <span className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: active ? "var(--blue)" : "#E8ECEF", color: active ? "white" : "#0C2433" }}><Icon size={30} /></span>
            <span className="text-[11px] font-bold text-center leading-tight">{item.name}</span>
          </Link>;
        })}
      </div>
      {menuOpen && <>
        <button aria-label="Close navigation" tabIndex={-1} onClick={() => setMenuOpen(false)} className="fixed inset-0 top-16 lg:top-12 bg-black/25 -z-10 2xl:hidden" />
        <div id="mobile-navigation" className="absolute top-16 lg:top-12 inset-x-0 bg-white shadow-xl border-b border-gray-200 p-4 max-h-[calc(100dvh-64px)] overflow-y-auto 2xl:hidden">
          <div className="text-xs text-gray-500 px-2 pb-3">{isSubUser ? "Your modules" : "Navigation"}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {mobileLinks.map(link => {
              const Icon = "icon" in link ? link.icon : link.href === "/whatsapp-setup" ? MessageCircle : FileText;
              return <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} aria-current={pathname === link.href ? "page" : undefined}
                className={`flex items-center gap-2 min-h-12 p-3 rounded-lg text-sm font-medium no-underline ${pathname === link.href ? "bg-sky-100 text-sky-900" : "text-gray-800 hover:bg-gray-100"}`}>
                <Icon size={18} className="shrink-0" /><span>{link.name}</span>
              </Link>;
            })}
          </div>
        </div>
      </>}
    </nav>
  );
}
