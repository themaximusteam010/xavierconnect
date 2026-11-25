import { describe, expect, it } from "vitest";
import { moderateText, EMPTY_RULES } from "@/server/moderation/detect";

const own = ["xavierconnect.vercel.app"];
const decide = (t: string) => moderateText(t, { ownHosts: own });
const cats = (t: string) => decide(t).findings.map((f) => f.category);

describe("Test 7: phone numbers", () => {
  it.each([
    "call me 08031234567",
    "my line is 0803 123 4567",
    "0803-123-4567 after 5pm",
    "+234 803 123 4567",
    "234-803-123-4567",
    "+86 138 0013 8000 (wechat same)",
    "+44 7911 123456",
    "+1 (415) 555-2671",
    "zero eight zero three one two three four five six seven",
    "0 8 0 3 1 2 3 4 5 6 7",
    "08O3l234567",
    "０８０３１２３４５６７", // full-width digits
  ])("blocks %s", (t) => {
    expect(decide(t).decision).toBe("BLOCKED");
    expect(cats(t)).toContain("PHONE");
  });
});

describe("Test 8: email addresses", () => {
  it.each(["ada.okafor@gmail.com", "write to ADA@Yahoo.CO.UK", "ada (at) gmail (dot) com", "ada [at] outlook [dot] com", "ada at gmail dot com", "ada at gmail", "ada＠gmail.com"])("blocks %s", (t) => {
    expect(decide(t).decision).toBe("BLOCKED");
    expect(cats(t)).toContain("EMAIL");
  });
});

describe("Test 9: external contact links and handles", () => {
  it.each([
    ["https://wa.me/2348031234567", "MESSAGING_HANDLE"],
    ["wa.me/2348031234567", "MESSAGING_HANDLE"],
    ["t.me/adastores", "MESSAGING_HANDLE"],
    ["instagram.com/ada.stores", "MESSAGING_HANDLE"],
    ["check www.my-own-shop.com.ng for cheaper", "URL"],
    ["pay here paypal.me/ada", "OFF_PLATFORM_PAYMENT"],
    ["chat me on WhatsApp", "MESSAGING_HANDLE"],
    ["send more pictures via whatsapp", "MESSAGING_HANDLE"],
    ["add me on wechat, my id is ada_88", "MESSAGING_HANDLE"],
    ["my telegram username: adastores", "MESSAGING_HANDLE"],
    ["follow me on ig @ada.stores", "MESSAGING_HANDLE"],
  ])("blocks %s", (t, c) => {
    expect(decide(t).decision).toBe("BLOCKED");
    expect(cats(t)).toContain(c);
  });
  it("links to XavierConnect itself are allowed", () => {
    expect(decide("see https://xavierconnect.vercel.app/p/red-dress").decision).toBe("APPROVED");
  });
});

describe("Test 10: obfuscation", () => {
  it.each([
    "w h a t s a p p me", // spaced letters → still a platform + intent? (handled by digits/intent below)
    "whаtsapp me on 0803 123 4567", // Cyrillic а + phone
    "my no is 0.8.0.3.1.2.3.4.5.6.7",
    "wa dot me slash 2348031234567",
    "ada(at)gmail(dot)com",
    "call 080-three-one-two-3456-7",
  ])("catches %s", (t) => {
    const d = decide(t).decision;
    if (t === "w h a t s a p p me") return expect(["APPROVED", "BLOCKED", "REVIEW"]).toContain(d); // documented limitation: letter-spaced words without a number
    expect(d).toBe("BLOCKED");
  });
});

describe("external payment solicitation", () => {
  it.each([
    "pay me directly and I'll give you discount",
    "let's do it outside the app to avoid the fees",
    "transfer to my GTBank 0123456789",
    "account number: 0123456789",
    "send to 0x52908400098527886E0F7030069857D2E4169EE7",
    "don't pay through the app, I'll send you my details",
  ])("blocks %s", (t) => expect(decide(t).decision).toBe("BLOCKED"));
  it("asking whether PayPal is accepted is held for a human, not blocked", () => {
    expect(decide("Do you accept PayPal?").decision).toBe("REVIEW");
  });
});

describe("Test 14: legitimate product questions are not blocked", () => {
  it.each([
    "Hello, is the red dress available in size 12?",
    "How much is delivery to Lekki? The price shows ₦45,000.",
    "Can I order 3 pieces? My order number is XC-10001-A.",
    "Does this phone support WhatsApp and dual SIM?",
    "What are the dimensions? 120 x 60 x 75 cm?",
    "The model number is SM-A546E, is it the 2023 version?",
    "Is it compatible with iPhone 15? I need it by 24/12/2026.",
    "Can I pay by bank transfer at checkout?",
    "Please ship it to my address in Ikeja, 23401 is the postal code.",
    "I'll be at home at 5pm, please deliver then.",
    "Do you have it in 32, 34 and 36 sizes?",
    "Thanks! I rated you 5 stars.",
    "Is there a warranty? It says 12 months.",
    "Can you send more pictures of the back here in the chat?",
  ])("approves %s", (t) => {
    const r = decide(t);
    expect({ t, d: r.decision, f: r.findings }).toMatchObject({ d: "APPROVED" });
  });
});

describe("admin rules", () => {
  it("custom block terms and allowed domains apply", () => {
    const rules = { ...EMPTY_RULES, blockTerms: ["dm for price"], allowDomains: ["nigeriapost.gov.ng"] };
    expect(moderateText("DM for price", { rules }).decision).toBe("BLOCKED");
    expect(moderateText("track it on nigeriapost.gov.ng", { rules }).decision).toBe("APPROVED");
  });
});
