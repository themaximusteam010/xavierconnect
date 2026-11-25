import { ProductListPage, type ProductSP } from "@/components/admin/product-list-page";
export const metadata = { title: "Digital products" };
export default async function Digital({ searchParams }: { searchParams: Promise<ProductSP> }) {
  return <ProductListPage sp={await searchParams} type="DIGITAL" base="/admin/digital" title="Digital products" />;
}
