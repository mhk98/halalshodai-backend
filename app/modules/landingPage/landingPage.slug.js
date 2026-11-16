const { Op } = require("sequelize");
const ApiError = require("../../../error/ApiError");

// Landing pages live at the site root (holydeen.com/<slug>), so a slug must never
// shadow a storefront route or a file the server answers itself.
const RESERVED_SLUGS = new Set([
  "account",
  "api",
  "categories",
  "category",
  "checkout",
  "contact",
  "contact-us",
  "favicon.ico",
  "images",
  "landing-page",
  "login",
  "order-success",
  "page",
  "product",
  "products",
  "re-confirm",
  "refund-policy",
  "robots.txt",
  "scratch-card",
  "sitemap.xml",
  "track-order",
]);

const MAX_SLUG_LENGTH = 150;

/**
 * Campaign title -> URL path. Keeps letters of any script (Bangla included, with its
 * vowel signs) and digits; everything else (spaces, emoji, punctuation) becomes "-".
 */
const toLandingSlug = (title) => {
  const slug = String(title || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  if (!slug) return "campaign";
  // A digits-only path is read as an old numeric landing page id.
  return /^\d+$/.test(slug) ? `campaign-${slug}` : slug;
};

/** A slug for `title` that no other landing page (deleted ones included) uses. */
const uniqueLandingSlug = async (LandingPage, title, excludeId = null) => {
  const base = toLandingSlug(title);
  const rows = await LandingPage.findAll({
    attributes: ["Id", "slug"],
    where: {
      slug: { [Op.or]: [base, { [Op.like]: `${base}-%` }] },
      ...(excludeId ? { Id: { [Op.ne]: excludeId } } : {}),
    },
    paranoid: false,
    raw: true,
  });
  const taken = new Set(rows.map((row) => row.slug));
  const isFree = (slug) => !taken.has(slug) && !RESERVED_SLUGS.has(slug);
  if (isFree(base)) return base;
  for (let n = 2; ; n += 1) {
    if (isFree(`${base}-${n}`)) return `${base}-${n}`;
  }
};

/**
 * A slug typed by an admin. Only English letters, digits and "-" are kept, so the
 * link stays short when shared (Bangla paths turn into long %E0%A6... codes).
 */
const toCustomSlug = (value) =>
  String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");

/** Validates an admin-typed slug and makes sure no live landing page uses it. */
const claimCustomSlug = async (LandingPage, value, excludeId = null) => {
  const slug = toCustomSlug(value);
  if (!slug) {
    throw new ApiError(400, "URL slug must use English letters or numbers, e.g. achar-offer");
  }
  if (/^\d+$/.test(slug)) {
    throw new ApiError(400, "URL slug must contain at least one letter");
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new ApiError(400, `"${slug}" is used by the website itself. Choose another URL slug.`);
  }
  const holder = await LandingPage.findOne({
    where: { slug, ...(excludeId ? { Id: { [Op.ne]: excludeId } } : {}) },
    paranoid: false,
  });
  if (holder && !holder.deletedAt) {
    throw new ApiError(400, `"${slug}" is already used by another landing page`);
  }
  // A deleted page no longer needs its link; free it for this one.
  if (holder) await holder.update({ slug: null }, { paranoid: false });
  return slug;
};

module.exports = { toLandingSlug, uniqueLandingSlug, toCustomSlug, claimCustomSlug, RESERVED_SLUGS };
