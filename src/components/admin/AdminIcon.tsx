"use client";

import { Search, ShoppingBag, Zap, Shield, QrCode, Wallet, Percent, Crown, Star, Package, LayoutDashboard, ClipboardList, Tags, Newspaper, Image, Bot, Menu, ExternalLink, LogOut, Pencil, Trash2, X, Plus, Minus, ChevronLeft, ChevronRight, ChevronDown, ArrowRight, Send, ArrowLeft, Landmark, Clock, Copy, CreditCard, House, Upload, Link, Settings, MessageSquare, Check, Globe, Mail, RefreshCw, Download, Info, BookOpen, Circle, type LucideIcon } from "lucide-react";
import type { IosIconName } from "@/components/ui/IosIcon";
import { Badge as UiBadge } from "./ui/badge";
export { CATEGORY_ICON_OPTIONS, categoryIcon, resolveCategoryIconName, BRAND_TINTS } from "@/components/ui/IosIcon";
export type { IosIconName } from "@/components/ui/IosIcon";

const icons: Partial<Record<IosIconName, LucideIcon>> = { search: Search, "shopping-bag": ShoppingBag, "lightning-bolt": Zap, shield: Shield, "qr-code": QrCode, wallet: Wallet, discount: Percent, crown: Crown, star: Star, packaging: Package, dashboard: LayoutDashboard, box: Package, "purchase-order": ClipboardList, category: Tags, news: Newspaper, image: Image, "full-image": Image, picture: Image, bot: Bot, chatbot: Bot, menu: Menu, "external-link": ExternalLink, exit: LogOut, "logout-rounded": LogOut, edit: Pencil, "create-new": Pencil, trash: Trash2, delete: Trash2, close: X, plus: Plus, minus: Minus, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, chevron: ChevronDown, "arrow-right": ArrowRight, send: Send, "left-arrow": ArrowLeft, "right-arrow": ArrowRight, back: ArrowLeft, arrow: ArrowRight, bag: ShoppingBag, bank: Landmark, clock: Clock, copy: Copy, "credit-card": CreditCard, home: House, upload: Upload, link: Link, settings: Settings, chat: MessageSquare, checked: Check, "checked-v2": Check, "overview-pages-1": LayoutDashboard, whatsapp: MessageSquare, "telegram-app": Send, globe: Globe, email: Mail, refresh: RefreshCw, download: Download, info: Info, "user-manual": BookOpen };

export function IosIcon({ name, size = 18, className, alt }: { name: IosIconName; size?: number; className?: string; alt?: string; tint?: string }) {
  const Icon = icons[name] ?? Circle;
  return <Icon size={size} strokeWidth={1.7} className={className} aria-hidden={!alt} aria-label={alt || undefined} role={alt ? "img" : undefined} />;
}

function Badge({ children, tone = "text-admin-muted" }: { children: React.ReactNode; tone?: string }) { return <UiBadge variant="outline" className={tone}>{children}</UiBadge>; }
export function ChannelBadge({ channel }: { channel: string }) { return <Badge>{({ web: "Web", telegram: "Telegram", whatsapp: "WhatsApp" } as Record<string, string>)[channel] ?? channel}</Badge>; }
export function StatusBadge({ status }: { status: string }) { return <Badge tone={status === "lunas" ? "text-admin-success" : status === "pending" ? "text-admin-warning" : status === "dibatalkan" ? "text-admin-danger" : undefined}>{status}</Badge>; }
export function MethodBadge({ method }: { method: string }) { return <Badge>{method.replace(/^nowpayments:/, "Crypto · ").replace(/^sekalipay_gateway:/, "Gateway · ")}</Badge>; }
