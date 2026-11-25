import { homepageSections } from "@/server/services/home";
import { BannerSection, CategoryGrid, Hero, HowItWorks, ProductRail, ServiceRail, VendorCta, VendorRail } from "@/components/home/sections";
import { RecentlyViewed } from "@/components/home/recently-viewed";
import type { HomepageSection } from "@prisma/client";

export const dynamic = "force-dynamic";

const RENDERERS: Record<string, (p: { s: HomepageSection }) => React.ReactNode> = {
  HERO: Hero,
  CATEGORY_GRID: CategoryGrid,
  PRODUCT_RAIL: ProductRail,
  SERVICE_RAIL: ServiceRail,
  VENDOR_RAIL: VendorRail,
  BANNER: BannerSection,
  HOW_IT_WORKS: HowItWorks,
  VENDOR_CTA: VendorCta,
  RECENTLY_VIEWED: () => <RecentlyViewed />,
};

/** The homepage is assembled from HomepageSection rows managed in Admin → Content. */
export default async function HomePage() {
  const sections = await homepageSections();
  const list = sections.length ? sections : ([{ id: "h", key: "hero", type: "HERO" }, { id: "c", key: "cats", type: "CATEGORY_GRID" }, { id: "n", key: "new", type: "PRODUCT_RAIL" }] as HomepageSection[]);
  return (
    <>
      {list.map((s) => {
        const R = RENDERERS[s.type];
        return R ? <R key={s.id} s={s} /> : null;
      })}
    </>
  );
}
