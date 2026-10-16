// /admin/users — list every weft.zip account for the super-admin to scan.
// Gate: `requireSuperAdminWeft()` throws notFound() for non-admins (a 404
// leaks less than a 403). The page stays a server component; the data
// fetching lives in UsersClient next door, which delegates to
// <AdminTablePage>'s `useResourceQuery` so the rest of the table UI comes
// from `@aimhuge/admin`.
import type { Metadata } from "next";
import { requireSuperAdminWeft, adminSessionFrom } from "@/lib/admin";
import UsersClient from "./UsersClient";

export const metadata: Metadata = { title: "Weft admin — Users" };

export default async function AdminUsersPage() {
  const { user } = await requireSuperAdminWeft();
  return <UsersClient session={adminSessionFrom(user)} />;
}
