"use client";

// Ikon metrik semantik Pedia — satu sumber agar kartu kebutuhan memakai makna
// yang berbeda per metrik (bukan ikon generik yang sama untuk semua).
// Memakai lucide-react yang sudah ada (tanpa dependensi baru):
// followers = UserPlus, subscribers/members = Users, likes/reactions = Heart,
// saves = Bookmark, views = Eye, plays = Play, traffic = Globe,
// shares = Share2, reposts = Repeat2, quotes = MessageSquareQuote,
// forks = GitFork.
import {
  Bookmark,
  MessageCircle,
  Hand,
  Download,
  ChartNoAxesCombined,
  Eye,
  GitFork,
  Globe,
  Heart,
  MessageSquareQuote,
  Play,
  Repeat2,
  Share2,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

export function pediaMetricIcon(metric: string): LucideIcon {
  switch (metric) {
    case "connections":
    case "followers":
      return UserPlus;
    case "listeners":
    case "subscribers":
    case "members":
      return Users;
    case "likes":
    case "reactions":
      return Heart;
    case "saves":
      return Bookmark;
    case "visits":
    case "views":
      return Eye;
    case "plays":
      return Play;
    case "traffic":
      return Globe;
    case "shares":
      return Share2;
    case "reposts":
      return Repeat2;
    case "quotes":
      return MessageSquareQuote;
    case "comments":
      return MessageCircle;
    case "claps":
      return Hand;
    case "downloads":
      return Download;
    case "forks":
      return GitFork;
    default:
      return ChartNoAxesCombined;
  }
}

export function MetricIcon({ metric, size = 20, tint = "white" }: { metric: string; size?: number; tint?: string }) {
  const Icon = pediaMetricIcon(metric);
  return <Icon size={size} color={tint} aria-hidden="true" data-testid={`metric-icon-${metric}`} />;
}
