import { redirect } from "next/navigation";
export default async function R({ params }: { params: Promise<{ id: string }> }) { redirect(`/admin/users/${(await params).id}`); }
