"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const colors = {
  text: "#E7F8EC",
  inactive: "#9fb7a6",
  border: "1px solid rgba(22,163,74,.35)",
};

type Item = { href: string; label: string; emoji: string };

const items: Item[] = [
  { href: "/", label: "Pay", emoji: "💎" },
  { href: "/history", label: "History", emoji: "📜" },
  { href: "/tasks", label: "Tasks", emoji: "✓" },
  { href: "/shop", label: "Shop", emoji: "🛍️" },
  { href: "/spin", label: "Spin", emoji: "🎯" },
];

export default function BottomNav({ className }: { className?: string }) {
  const pathname = usePathname() || "/";
  return (
    <nav
      className={`${className ?? "mt-3"} grid grid-cols-5 text-xs text-center rounded-xl overflow-hidden`}
      style={{ border: colors.border }}
    >
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`py-2 ${active ? "bg-white/5" : "bg-transparent"}`}
            style={{ color: active ? colors.text : colors.inactive }}
          >
            <div className="text-sm">{item.emoji}</div>
            <div className="mt-0.5 text-[10px]">{item.label}</div>
          </Link>
        );
      })}
    </nav>
  );
}


