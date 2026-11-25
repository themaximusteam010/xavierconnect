/**
 * Seed: platform configuration (always) + an optional, clearly-labelled demo catalogue.
 *
 *   npm run db:seed                 → roles, admin, categories, commission, plans, CMS content
 *   SEED_DEMO=true npm run db:seed  → also creates demo stores and listings named "(Demo)"
 *
 * The demo data contains NO orders, reviews, ratings, sales counts or testimonials. Every
 * number shown in the UI comes from real activity.
 */
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { syncRbac } from "./rbac-sync";

const db = new PrismaClient();
const NGN = (naira: number) => BigInt(Math.round(naira * 100));

const PRODUCT_CATEGORIES: [string, string, string[]][] = [
  ["Electronics", "electronics", ["Phones & Tablets", "Computers & Accessories", "Audio", "Power & Solar"]],
  ["Fashion", "fashion", ["Men's Clothing", "Women's Clothing", "Ankara & Native Wear", "Shoes", "Bags & Accessories"]],
  ["Home & Kitchen", "home-kitchen", ["Cookware", "Small Appliances", "Furniture", "Home Décor"]],
  ["Beauty & Personal Care", "beauty", ["Skincare", "Hair Care", "Fragrance"]],
  ["Groceries", "groceries", ["Pantry Staples", "Beverages", "Spices & Seasoning"]],
  ["Health & Wellness", "health", []],
  ["Baby & Kids", "baby-kids", []],
  ["Office & Stationery", "office", []],
  ["Arts & Crafts", "arts-crafts", []],
  ["Sports & Outdoors", "sports", []],
];
const DIGITAL_CATEGORIES: [string, string][] = [
  ["E-books", "ebooks"], ["Templates", "templates"], ["Courses & Training", "courses"], ["Graphics & Fonts", "graphics"], ["Software & Themes", "software"], ["Audio & Video", "audio-video"], ["Planners & Documents", "planners"],
];
const SERVICE_CATEGORIES = [
  "Graphic Design", "Website Development", "Software Development", "Digital Marketing", "Photography", "Videography", "Business Consulting", "Accounting & Bookkeeping",
  "Cleaning", "Repairs", "Plumbing", "Electrical Services", "Event Planning", "Catering", "Beauty Services", "Tutoring & Education", "Fitness Coaching", "Transportation", "Professional Services",
];

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function categories() {
  let i = 0;
  for (const [name, s, children] of PRODUCT_CATEGORIES) {
    const parent = await db.category.upsert({ where: { slug: s }, update: { name, sortOrder: i }, create: { slug: s, name, kind: "PRODUCT", sortOrder: i++, isFeatured: i <= 6 } });
    let j = 0;
    for (const c of children) await db.category.upsert({ where: { slug: `${s}-${slug(c)}` }, update: {}, create: { slug: `${s}-${slug(c)}`, name: c, kind: "PRODUCT", parentId: parent.id, sortOrder: j++ } });
  }
  const digital = await db.category.upsert({ where: { slug: "digital" }, update: {}, create: { slug: "digital", name: "Digital Products", kind: "DIGITAL", sortOrder: 50 } });
  let k = 0;
  for (const [name, s] of DIGITAL_CATEGORIES) await db.category.upsert({ where: { slug: `digital-${s}` }, update: {}, create: { slug: `digital-${s}`, name, kind: "DIGITAL", parentId: digital.id, sortOrder: k++ } });
  const services = await db.category.upsert({ where: { slug: "services" }, update: {}, create: { slug: "services", name: "Services", kind: "SERVICE", sortOrder: 60 } });
  let m = 0;
  for (const name of SERVICE_CATEGORIES) await db.category.upsert({ where: { slug: `svc-${slug(name)}` }, update: {}, create: { slug: `svc-${slug(name)}`, name, kind: "SERVICE", parentId: services.id, sortOrder: m++ } });
}

async function platform() {
  if (!(await db.commissionRule.findFirst({ where: { scope: "GLOBAL" } }))) {
    await db.commissionRule.create({ data: { scope: "GLOBAL", name: "Default marketplace commission", rateBps: 1000 } });
  }
  const plans = [
    { key: "STARTER", name: "Starter", priceMinor: 0n, listingLimit: 25, commissionBps: 1000, features: ["Up to 25 listings", "Standard storefront", "10% commission"] },
    { key: "GROWTH", name: "Growth", priceMinor: NGN(7_500), listingLimit: 200, commissionBps: 800, features: ["Up to 200 listings", "Coupons and flash sales", "8% commission"] },
    { key: "BUSINESS", name: "Business", priceMinor: NGN(25_000), listingLimit: 2000, commissionBps: 650, features: ["Up to 2,000 listings", "Staff accounts", "6.5% commission"] },
    { key: "ENTERPRISE", name: "Enterprise", priceMinor: NGN(0), listingLimit: null, commissionBps: null, features: ["Unlimited listings", "Negotiated commission", "Account manager"] },
  ];
  for (const [i, p] of plans.entries()) await db.subscriptionPlan.upsert({ where: { key: p.key }, update: {}, create: { ...p, sortOrder: i } });
  for (const p of plans) {
    if (p.commissionBps && !(await db.commissionRule.findFirst({ where: { scope: "SUBSCRIPTION", planKey: p.key } }))) {
      await db.commissionRule.create({ data: { scope: "SUBSCRIPTION", planKey: p.key, name: `${p.name} plan`, rateBps: p.commissionBps } });
    }
  }

  const sections = [
    { key: "hero", type: "HERO", sortOrder: 0 },
    { key: "categories", type: "CATEGORY_GRID", title: "Shop by category", sortOrder: 10, config: { limit: 12 } },
    { key: "featured", type: "PRODUCT_RAIL", title: "Featured products", sortOrder: 20, config: { source: "featured", limit: 10 } },
    { key: "new", type: "PRODUCT_RAIL", title: "New arrivals", sortOrder: 30, config: { source: "new", limit: 10 } },
    { key: "banner-mid", type: "BANNER", sortOrder: 35, config: { placement: "HOME_MID" } },
    { key: "bestsellers", type: "PRODUCT_RAIL", title: "Best sellers", subtitle: "Ranked by completed orders", sortOrder: 40, config: { source: "bestsellers", limit: 10 } },
    { key: "services", type: "SERVICE_RAIL", title: "Popular services", sortOrder: 50 },
    { key: "deals", type: "PRODUCT_RAIL", title: "Special offers", sortOrder: 55, config: { source: "deals", limit: 5 } },
    { key: "stores", type: "VENDOR_RAIL", title: "Featured stores", sortOrder: 60 },
    { key: "digital", type: "PRODUCT_RAIL", title: "Digital products", subtitle: "Instant download after payment", sortOrder: 70, config: { source: "digital", limit: 5 } },
    { key: "recent", type: "RECENTLY_VIEWED", sortOrder: 75 },
    { key: "how", type: "HOW_IT_WORKS", sortOrder: 80 },
    { key: "sell", type: "VENDOR_CTA", sortOrder: 90 },
  ];
  for (const s of sections) await db.homepageSection.upsert({ where: { key: s.key }, update: {}, create: s });

  if ((await db.banner.count()) === 0) {
    await db.banner.createMany({
      data: [
        { placement: "HOME_MID", eyebrow: "For buyers", title: "One payment, several sellers", body: "Fill one cart from as many stores as you like. Each seller ships their own items and you track every shipment from your account.", ctaLabel: "Start shopping", ctaHref: "/shop", tone: "blue", sortOrder: 0 },
        { placement: "HOME_MID", eyebrow: "For professionals", title: "Take bookings, not just enquiries", body: "List your service with packages and opening hours. Customers pick a time and pay upfront.", ctaLabel: "Offer a service", ctaHref: "/sell", tone: "charcoal", sortOrder: 1 },
      ],
    });
  }

  const pages: [string, string, string][] = [
    ["about", "About XavierConnect", "## Who we are\n\nXavierConnect is a multi-vendor marketplace operated by **Xavier Enterprise**. We connect buyers with independent sellers, service professionals and creators across Nigeria.\n\n## What we do\n\n- Give every approved seller a storefront, an order dashboard and payouts to a Nigerian bank account.\n- Hold customer payments with licensed payment providers until orders are delivered.\n- Check seller identity and business documents before showing a verification badge.\n\n## Our promise\n\nDiscover products. Find services. Grow businesses."],
    ["terms", "Terms and Conditions", "## 1. About these terms\n\nThese terms govern your use of XavierConnect, operated by Xavier Enterprise. By creating an account or placing an order you agree to them.\n\n## 2. Orders\n\nWhen you buy from several sellers in one checkout, you enter into a separate contract with each seller for their items. XavierConnect facilitates the transaction and holds payment until delivery.\n\n## 3. Payments\n\nPayments are processed by licensed third-party providers. We never store full card details.\n\n## 4. Disputes\n\nIf an order arrives damaged, incorrect or not at all, open a dispute from your order page within the return window.\n\n*This document is a starting template and must be reviewed by a qualified Nigerian lawyer before launch.*"],
    ["privacy", "Privacy Policy", "## What we collect\n\nAccount details (name, email, phone), delivery addresses, order history and, for sellers, verification documents.\n\n## How we use it\n\nTo process orders, pay sellers, prevent fraud and provide support. We do not sell personal data.\n\n## Your rights\n\nUnder the Nigeria Data Protection Act 2023 you may request access to, correction of, or deletion of your personal data by contacting privacy@xavierconnect.com.\n\n*Template — requires legal review before launch.*"],
    ["refunds", "Refund Policy", "Refunds are issued to the original payment method. When a seller cancels or a dispute is decided in your favour, the refund is started immediately; banks typically take 5–10 business days to return funds.\n\n*Template — requires legal review before launch.*"],
    ["returns", "Return Policy", "Unless a listing says otherwise, physical items can be returned within 7 days of delivery if they are not as described, damaged or defective. Digital products are refundable only where the listing states so.\n\n*Template — requires legal review before launch.*"],
    ["shipping", "Shipping Policy", "Each seller ships their own items and sets their own delivery options, which you choose at checkout. Delivery estimates are shown per seller. Tracking details appear in your order once the seller dispatches.\n\n*Template — requires legal review before launch.*"],
    ["vendor-agreement", "Vendor Agreement", "## Commission\n\nXavierConnect charges a commission on each completed sale according to your plan and the category commission table.\n\n## Settlement\n\nEarnings become available for withdrawal after the order is delivered and the return window has passed.\n\n## Prohibited items\n\nSellers may not list counterfeit goods, weapons, controlled substances, or any item prohibited by Nigerian law.\n\n*Template — requires legal review before launch.*"],
    ["cookies", "Cookie Policy", "We use strictly necessary cookies to keep you signed in and remember your cart. We do not use advertising cookies.\n\n*Template — requires legal review before launch.*"],
  ];
  for (const [s, title, body] of pages) await db.cmsPage.upsert({ where: { slug: s }, update: {}, create: { slug: s, title, body } });

  if ((await db.faq.count()) === 0) {
    const faqs: [string, string, string][] = [
      ["Buying", "Can I buy from several sellers at once?", "Yes. Add items from any number of stores and pay once. Each seller ships their own items, and you can track each shipment separately in your order."],
      ["Buying", "Do I need an account to buy?", "No — you can check out as a guest for physical items. Digital products require an account so your downloads stay safe."],
      ["Payments", "When does the seller get my money?", "Your payment is held by our payment partner. The seller's earnings are released after delivery and a short return window."],
      ["Payments", "Which payment methods are accepted?", "Cards, bank transfer and other methods supported by our payment partner in Nigeria."],
      ["Returns", "How do I return an item?", "Open your order, choose “Get help with this order” and tell us what went wrong within 7 days of delivery."],
      ["Selling", "How do I become a vendor?", "Create an account, confirm your email, then complete the seller application. Our team reviews applications within two business days."],
      ["Selling", "How much does it cost to sell?", "The Starter plan has no monthly fee. A commission is charged only on completed sales."],
      ["Selling", "How do withdrawals work?", "Once earnings are available, request a withdrawal to your verified Nigerian bank account from Earnings in your dashboard."],
      ["Digital downloads", "How long do download links last?", "Each purchase includes 5 downloads over 30 days. Contact support if you need access restored."],
      ["Bookings", "Can I reschedule a booking?", "Message the provider from your booking. Rescheduling depends on their availability and cancellation policy."],
    ];
    await db.faq.createMany({ data: faqs.map(([category, question, answer], i) => ({ category, question, answer, sortOrder: i })) });
  }
}

async function admin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping super admin creation.");
    return;
  }
  const role = await db.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  const customer = await db.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Platform Administrator", passwordHash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }), emailVerifiedAt: new Date() },
  });
  for (const r of [role, customer]) {
    if (!(await db.userRole.findFirst({ where: { userId: user.id, roleId: r.id, vendorId: null } }))) await db.userRole.create({ data: { userId: user.id, roleId: r.id } });
  }
  console.log(`Super admin: ${email}`);
}

// ─── Demo catalogue (opt-in) ──────────────────────────────────────────────────

type DemoProduct = { name: string; cat: string; price: number; sale?: number; stock: number; brand?: string; weight?: number; desc: string; short: string; attrs?: Record<string, string>; variants?: [string, number][]; digital?: { format: string; mb: number } };
type DemoStore = { key: string; name: string; type: "BUSINESS" | "INDIVIDUAL" | "SERVICE_PROVIDER"; city: string; state: string; tagline: string; products?: DemoProduct[]; services?: { title: string; cat: string; summary: string; location: "ONSITE" | "REMOTE" | "BOTH"; pkgs: [string, number, number][] }[] };

const DEMO: DemoStore[] = [
  {
    key: "ikeja-gadgets", name: "Ikeja Gadget Hub (Demo)", type: "BUSINESS", city: "Ikeja", state: "Lagos", tagline: "Phones, power and accessories",
    products: [
      { name: "20,000mAh Power Bank with USB-C PD", cat: "electronics-power-and-solar", price: 24_500, sale: 21_900, stock: 40, brand: "Oraimo", weight: 420, short: "Charges a phone about four times. 22.5W fast charging over USB-C.", desc: "A high-capacity power bank for long days and NEPA outages.\n\n• 20,000mAh lithium-polymer cells\n• 22.5W USB-C Power Delivery in and out\n• Two USB-A ports\n• LED charge indicator", attrs: { capacity: "20,000mAh", output: "22.5W max", ports: "1× USB-C, 2× USB-A" } },
      { name: "Wireless Earbuds, 30-hour Battery", cat: "electronics-audio", price: 18_000, stock: 25, brand: "Oraimo", weight: 120, short: "Bluetooth 5.3 earbuds with charging case.", desc: "Comfortable everyday earbuds with clear calls and a pocketable case.", attrs: { bluetooth: "5.3", battery: "Up to 30h with case" } },
      { name: "1.5kVA Pure Sine Wave Inverter", cat: "electronics-power-and-solar", price: 285_000, stock: 6, brand: "Felicity", weight: 14_000, short: "Quiet backup power for a small home or office.", desc: "Pure sine wave output safe for laptops, TVs and fridges. Supports 12V/24V battery banks.", attrs: { capacity: "1.5kVA", waveform: "Pure sine" } },
      { name: "USB-C to Lightning Cable, 1m", cat: "electronics-computers-and-accessories", price: 4_500, stock: 120, weight: 40, short: "Braided cable for fast charging iPhones.", desc: "Durable braided cable rated for 10,000+ bends." },
    ],
  },
  {
    key: "adire-house", name: "Adire House Abeokuta (Demo)", type: "INDIVIDUAL", city: "Abeokuta", state: "Ogun", tagline: "Hand-dyed adire and ready-to-wear",
    products: [
      { name: "Hand-dyed Adire Shirt, Indigo", cat: "fashion-ankara-and-native-wear", price: 22_000, stock: 18, weight: 300, short: "Short-sleeve cotton shirt, hand-dyed in Abeokuta.", desc: "Each shirt is resist-dyed by hand, so patterns vary slightly. Cold wash separately.", attrs: { material: "100% cotton", fit: "Regular" }, variants: [["M", 6], ["L", 8], ["XL", 4]] },
      { name: "Adire Fabric, 2 Yards", cat: "fashion-ankara-and-native-wear", price: 15_000, sale: 12_500, stock: 30, weight: 400, short: "Indigo adire fabric for tailoring.", desc: "Two yards of hand-dyed cotton adire, ready for your tailor." },
      { name: "Woven Raffia Tote Bag", cat: "fashion-bags-and-accessories", price: 9_500, stock: 12, weight: 350, short: "Hand-woven tote with leather handles.", desc: "Roomy, sturdy and made by artisans in Ogun State." },
    ],
  },
  {
    key: "mama-put-pantry", name: "Mama's Pantry Ibadan (Demo)", type: "BUSINESS", city: "Ibadan", state: "Oyo", tagline: "Spices, grains and home staples",
    products: [
      { name: "Suya Spice (Yaji), 250g", cat: "groceries-spices-and-seasoning", price: 3_200, stock: 200, weight: 260, short: "Freshly ground yaji with groundnut, ginger and pepper.", desc: "Our house blend, ground weekly in small batches." },
      { name: "Ofada Rice, 5kg", cat: "groceries-pantry-staples", price: 14_500, stock: 60, weight: 5_100, short: "Locally grown, stone-free ofada rice.", desc: "Destoned and double-washed. Store in a cool, dry place." },
      { name: "Zobo Leaves (Dried Hibiscus), 500g", cat: "groceries-beverages", price: 2_800, stock: 150, weight: 520, short: "Dried hibiscus for zobo drink.", desc: "Clean, deep-red calyces sourced from northern Nigeria." },
    ],
  },
  {
    key: "studio-nine", name: "Studio Nine Creative (Demo)", type: "SERVICE_PROVIDER", city: "Wuse", state: "FCT", tagline: "Brand identity, web and photography",
    products: [
      { name: "Small Business Invoice & Receipt Template Pack", cat: "digital-templates", price: 6_000, stock: 0, short: "Editable invoice, receipt and quotation templates.", desc: "12 templates in Word and Google Docs formats, with VAT lines for Nigerian businesses.", digital: { format: "zip", mb: 4.2 } },
      { name: "Social Media Content Planner 2027", cat: "digital-planners", price: 4_500, stock: 0, short: "Printable and digital planner for a year of posts.", desc: "Monthly calendars, campaign planners and analytics trackers in PDF.", digital: { format: "pdf", mb: 9.8 } },
    ],
    services: [
      { title: "Logo and brand identity design", cat: "svc-graphic-design", location: "REMOTE", summary: "A logo, colour palette and type system for your business.", pkgs: [["Basic — Logo only", 75_000, 60], ["Standard — Logo + brand guide", 180_000, 90], ["Premium — Full identity + stationery", 350_000, 120]] },
      { title: "Product photography session", cat: "svc-photography", location: "ONSITE", summary: "Clean, consistent photos of your products for your store.", pkgs: [["Basic — 10 products", 60_000, 120], ["Standard — 25 products", 120_000, 240], ["Premium — 50 products + lifestyle", 220_000, 480]] },
    ],
  },
];

async function demo() {
  const password = await hash("Demo-Vendor-2026!", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const customer = await db.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
  for (const s of DEMO) {
    const email = `${s.key}@demo.xavierconnect.local`;
    const owner = await db.user.upsert({ where: { email }, update: {}, create: { email, name: s.name.replace(" (Demo)", ""), passwordHash: password, emailVerifiedAt: new Date(), roles: { create: { roleId: customer.id } } } });
    let vendor = await db.vendor.findFirst({ where: { ownerId: owner.id } });
    if (!vendor) {
      vendor = await db.vendor.create({
        data: {
          ownerId: owner.id, type: s.type, status: "APPROVED", verificationLevel: "BASIC", businessName: s.name, description: `Demonstration store — not a real business. ${s.tagline}.`,
          businessCategory: s.tagline, email, phone: "08000000000", addressLine1: "Demo address", city: s.city, state: s.state, agreementAcceptedAt: new Date(), agreementVersion: "2026-11", submittedAt: new Date(), reviewedAt: new Date(),
          store: { create: { slug: s.key, name: s.name, tagline: s.tagline, description: `This is a demonstration store created by the seed script so you can explore XavierConnect. It is not a real business and orders cannot be fulfilled.`, city: s.city, state: s.state } },
          shippingMethods: s.type === "SERVICE_PROVIDER" ? undefined : { create: [
            { name: `Within ${s.state}`, type: "FLAT", rateMinor: NGN(2_500), states: [s.state], etaDaysMin: 1, etaDaysMax: 2, freeOverMinor: NGN(50_000) },
            { name: "Nationwide (GIG Logistics)", type: "WEIGHT", rateMinor: NGN(3_500), perKgMinor: NGN(500), etaDaysMin: 3, etaDaysMax: 6 },
            { name: "Pick up from store", type: "PICKUP", rateMinor: 0n, etaDaysMin: 0, etaDaysMax: 1 },
          ] },
        },
      });
      const role = await db.role.findUniqueOrThrow({ where: { key: s.type === "SERVICE_PROVIDER" ? "SERVICE_PROVIDER" : "VENDOR" } });
      await db.userRole.create({ data: { userId: owner.id, roleId: role.id, vendorId: vendor.id } });
    }
    for (const [i, p] of (s.products ?? []).entries()) {
      const pslug = `${slug(p.name)}-${s.key}`.slice(0, 90);
      if (await db.product.findUnique({ where: { slug: pslug } })) continue;
      const cat = await db.category.findUniqueOrThrow({ where: { slug: p.cat } });
      await db.product.create({
        data: {
          vendorId: vendor.id, categoryId: cat.id, type: p.digital ? "DIGITAL" : "PHYSICAL", status: "PUBLISHED", name: p.name, slug: pslug, sku: `${s.key.slice(0, 3).toUpperCase()}-${1000 + i}`,
          brand: p.brand, shortDescription: p.short, description: p.desc, priceMinor: NGN(p.price), salePriceMinor: p.sale ? NGN(p.sale) : null,
          stockQuantity: p.variants ? p.variants.reduce((a, [, n]) => a + n, 0) : p.stock, trackInventory: !p.digital, weightGrams: p.weight, attributes: p.attrs, isFeatured: i === 0,
          tags: p.name.toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 6),
          licenceTerms: p.digital ? "Personal and single-business commercial use. Do not resell or redistribute." : null,
          variants: p.variants ? { create: p.variants.map(([name, stock]) => ({ name, options: { size: name }, stockQuantity: stock })) } : undefined,
          digitalAssets: p.digital ? { create: { fileKey: `private/demo/${pslug}.${p.digital.format}`, fileName: `${slug(p.name)}.${p.digital.format}`, format: p.digital.format, sizeBytes: Math.round(p.digital.mb * 1_048_576) } } : undefined,
        },
      });
    }
    for (const sv of s.services ?? []) {
      const sslug = `${slug(sv.title)}-${s.key}`;
      if (await db.service.findUnique({ where: { slug: sslug } })) continue;
      const cat = await db.category.findUniqueOrThrow({ where: { slug: sv.cat } });
      await db.service.create({
        data: {
          vendorId: vendor.id, categoryId: cat.id, status: "PUBLISHED", title: sv.title, slug: sslug, summary: sv.summary, description: `${sv.summary}\n\nThis is a demonstration listing.`, location: sv.location, city: s.city, state: s.state,
          cancellationPolicy: "Free cancellation up to 24 hours before the appointment.",
          packages: { create: sv.pkgs.map(([name, price, mins], i) => ({ tier: (["BASIC", "STANDARD", "PREMIUM"] as const)[i], name, description: name.split("—")[1]?.trim() ?? name, priceMinor: NGN(price), durationMinutes: mins, deliveryDays: 3 + i * 4 })) },
          availability: { create: [1, 2, 3, 4, 5].map((d) => ({ weekday: d, startMinute: 9 * 60, endMinute: 17 * 60 })).concat([{ weekday: 6, startMinute: 10 * 60, endMinute: 14 * 60 }]) },
        },
      });
    }
  }
  // Demo storage files for digital products so downloads work end to end.
  const fs = await import("node:fs/promises");
  for (const a of await db.digitalAsset.findMany({ where: { fileKey: { startsWith: "private/demo/" } } })) {
    const path = `storage/${a.fileKey}`;
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(path, `XavierConnect demo download: ${a.fileName}\nThis placeholder file stands in for the vendor's real upload.\n`).catch(() => {});
  }
  if (!(await db.coupon.findUnique({ where: { code: "WELCOME10" } }))) {
    await db.coupon.create({ data: { code: "WELCOME10", type: "PERCENT", value: 1000, maxDiscountMinor: NGN(5_000), minSubtotalMinor: NGN(10_000) } });
  }
  console.log(`Demo catalogue ready. Demo vendor password: Demo-Vendor-2026!`);
}

async function main() {
  await syncRbac(db);
  await categories();
  await platform();
  await admin();
  if (process.env.SEED_DEMO === "true") await demo();
  console.log("Seed complete.");
}

main().finally(() => db.$disconnect());
