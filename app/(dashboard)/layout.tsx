"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import TopNav from "@/components/TopNav";
import Toast from "@/components/Toast";
import ConfirmModal from "@/components/ConfirmModal";
import { UserContext } from "@/lib/UserContext";
import { fetchUserProfile } from "@/lib/userProfile";
import type { UserProfile } from "@/lib/userProfile";

import { canAccessPath, firstAllowedPath } from "@/lib/moduleAccess";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const preserveNumberOnScroll = (event: WheelEvent) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.type === "number" && document.activeElement === input) {
        input.blur();
      }
    };
    document.addEventListener("wheel", preserveNumberOnScroll, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", preserveNumberOnScroll, true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const p = await fetchUserProfile();
        if (!cancelled) setProfile(p);
        if (!cancelled && !p) router.replace("/");
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(onFocus, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [router]);

  useEffect(() => {
    if (checking || !profile) return;
    if (!canAccessPath(profile, pathname)) {
      router.replace(firstAllowedPath(profile));
    }
  }, [checking, profile, pathname, router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="w-8 h-8 border-3 border-[var(--gray-200)] border-t-[var(--blue)] rounded-full animate-spin" />
      </div>
    );
  }

  // Prevent flash of restricted content before redirect fires
  if (profile && !canAccessPath(profile, pathname)) {
    return null;
  }

  return (
    <UserContext.Provider value={profile}>
      <div className="min-h-screen" style={{ background: "var(--bg)" }}>
        <TopNav />
        <main className="pt-[var(--header-h)] min-h-screen">
          <div className="p-3 sm:p-6 lg:p-8 pb-16">
            {children}
          </div>
        </main>
        <footer
          className="fixed bottom-0 right-0 left-0 py-2 no-print flex items-center justify-center gap-6 px-6"
          style={{ background: "var(--bg)", color: "#000", fontSize: 13 }}
        >
          <span style={{ fontWeight: 500 }}>Software Developed by AddsMint.com</span>
        </footer>
        <Toast />
        <ConfirmModal />
      </div>
    </UserContext.Provider>
  );
}
