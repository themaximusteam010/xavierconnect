import { redirect } from "next/navigation";
export default function Deals() { redirect("/shop?onSale=1&sort=popular"); }
