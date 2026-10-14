"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Monitor, FileText, LogOut,
  Package, BarChart2, Users, FileSignature, Truck, ClipboardList, History, UserCog, Receipt, RotateCcw,
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

  return (
    <nav className="fixed top-0 left-0 right-0 z-[200] no-print">

      {/* ── Brand bar ── */}
      <div
        className="flex items-center px-5 h-12 gap-6"
        style={{
          background: "var(--accent-sky)",
          borderBottom: "1px solid #86efac",
        }}
      >
        {/* Brand — same treatment as login page (app/page.tsx) */}
        <Link href={userProfile ? firstAllowedPath(userProfile) : "/"} className="flex items-center gap-2.5 shrink-0 no-underline" title="Dashboard">
          <img
            src="/brand/logo.svg"
            alt="S.S. Diagnostics"
            className="h-9 w-[167px] object-contain shrink-0"
          />
        </Link>

        {/* Menu bar links — right of logo */}
        <div className="flex items-stretch gap-0.5 flex-1">
          {isSubUser && (
            <span
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full text-[var(--blue-deeper)] self-center"
              style={{ background: "rgba(3,105,161,0.06)" }}
            >
              Sub User
            </span>
          )}
          {visibleMenuLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="relative flex items-center px-3.5 h-12 text-[12.5px] font-semibold no-underline transition-all whitespace-nowrap"
                style={{
                  color: isActive ? "var(--blue-deeper)" : "var(--gray-700)",
                  background: isActive ? "rgba(3,105,161,0.10)" : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(3,105,161,0.06)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "";
                }}
              >
                {isActive && (
                  <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full bg-[var(--blue)]" />
                )}
                {link.name}
              </Link>
            );
          })}
        </div>

        {/* Date + user — pushed to far right */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[12px] font-semibold text-[var(--blue-deeper)] hidden md:block">{today}</span>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="flex items-center gap-2 cursor-pointer rounded-full py-1 pl-1 pr-2.5 transition-all hover:bg-white/40 border-none bg-transparent"
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white shrink-0"
              style={{ background: "var(--blue)" }}
            >
              {getInitials(displayName)}
            </div>
            <span className="text-[12px] font-medium text-[var(--blue-deeper)] hidden sm:block">{displayName}</span>
            <LogOut size={13} className="ml-0.5 text-[var(--blue-deeper)]" />
          </button>
        </div>
      </div>

      {/* ── Icon toolbar ── */}
      <div
        className="bg-white border-b border-[var(--gray-200)] flex items-stretch overflow-x-auto nav-scrollbar-hide"
        style={{ height: "106px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
      >
        {toolbarItems.map((item, i) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <div key={item.href} className="flex items-stretch shrink-0">
              {i > 0 && (
                <div className="self-stretch w-[1.5px] my-4 shrink-0" style={{ background: "#0C2433" }} />
              )}
              <Link
                href={item.href}
                className="relative flex flex-col items-center justify-center gap-2 px-5 sm:px-7 min-w-[92px] sm:min-w-[100px] max-w-[132px] no-underline transition-all duration-150"
                style={{ background: isActive ? "var(--blue-light)" : undefined }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--blue-pale)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "";
                }}
              >
                {isActive && (
                  <div
                    className="absolute bottom-0 left-3 right-3 h-[3px] rounded-t-full"
                    style={{ background: "var(--blue)" }}
                  />
                )}

                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center transition-all shrink-0"
                  style={{
                    background: isActive ? "var(--blue)" : "#E8ECEF",
                    color: isActive ? "white" : "#0C2433",
                    boxShadow: isActive ? "0 3px 12px rgba(140,0,0,0.28)" : undefined,
                  }}
                >
                  <Icon size={30} />
                </div>

                <span
                  className="text-[10.5px] sm:text-[11px] font-bold text-center leading-tight px-0.5"
                  style={{ color: isActive ? "var(--blue-deeper)" : "#0C2433" }}
                >
                  {item.name}
                </span>
              </Link>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
