import { ProductListPage, type ProductSP } from "@/components/admin/product-list-page";
export const metadata = { title: "Products" };
export default async function Products({ searchParams }: { searchParams: Promise<ProductSP> }) {
  return <ProductListPage sp={await searchParams} type="PHYSICAL" base="/admin/products" title="Products" />;
}
