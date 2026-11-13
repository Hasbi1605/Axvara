import { cookies } from "next/headers";
import { AdminWorkspace } from "@/components/admin/AdminWorkspace";

export const runtime = "edge";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const preference = (await cookies()).get("axvara-admin-theme")?.value;
  return <AdminWorkspace initialTheme={preference === "light" || preference === "dark" ? preference : "system"}>{children}</AdminWorkspace>;
}
