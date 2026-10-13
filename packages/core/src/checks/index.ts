import type { CheckModule } from './context.js';
import { check as tlsValid } from './tls-valid.js';
import { check as tlsExpiry } from './tls-expiry.js';
import { check as httpsRedirect } from './https-redirect.js';
import { check as hsts } from './hsts.js';
import { check as csp } from './csp.js';
import { check as cspStrength } from './csp-strength.js';
import { check as xFrameOptions } from './x-frame-options.js';
import { check as xContentTypeOptions } from './x-content-type-options.js';
import { check as referrerPolicy } from './referrer-policy.js';
import { check as permissionsPolicy } from './permissions-policy.js';
import { check as cookieFlags } from './cookie-flags.js';
import { check as corsWildcardCredentials } from './cors-wildcard-credentials.js';
import { check as serverLeak } from './server-leak.js';
import { check as sourceMaps } from './source-maps.js';
import { check as secretsInBundle } from './secrets-in-bundle.js';
import { check as supabaseRestExposed } from './supabase-rest-exposed.js';
import { check as firebaseConfig } from './firebase-config.js';
import { check as stripeTestKeyInProd } from './stripe-test-key-in-prod.js';
import { check as aiLeftovers } from './ai-leftovers.js';
import { check as exposedEnvFiles } from './exposed-env-files.js';
import { check as exposedGit } from './exposed-git.js';
import { check as exposedInternalFiles } from './exposed-internal-files.js';
import { check as openAdminRoutes } from './open-admin-routes.js';
import { check as supabaseAnonRowRead } from './supabase-anon-row-read.js';
import { check as storageBucketListing } from './storage-bucket-listing.js';
import { check as rateLimit } from './rate-limit.js';
import { check as spf } from './spf.js';
import { check as dkim } from './dkim.js';
import { check as dmarc } from './dmarc.js';
import { check as mx } from './mx.js';
import { check as authSenderAuthenticated } from './auth-sender-authenticated.js';
import { check as nameservers } from './nameservers.js';
import { check as dnssec } from './dnssec.js';
import { check as caa } from './caa.js';
import { check as domainExpiry } from './domain-expiry.js';
import { check as securityTxt } from './security-txt.js';
import { check as legalPages } from './legal-pages.js';
import { check as title } from './title.js';
import { check as metaDescription } from './meta-description.js';
import { check as canonical } from './canonical.js';
import { check as h1 } from './h1.js';
import { check as langViewport } from './lang-viewport.js';
import { check as ogImage } from './og-image.js';
import { check as jsonLd } from './json-ld.js';
import { check as robotsTxt } from './robots-txt.js';
import { check as sitemap } from './sitemap.js';
import { check as notFoundPage } from './not-found-page.js';
import { check as favicon } from './favicon.js';
import { check as mixedContent } from './mixed-content.js';
import { check as brokenLinksHome } from './broken-links-home.js';
import { check as llmsTxt } from './llms-txt.js';
import { check as aiCrawlerPolicy } from './ai-crawler-policy.js';
import { check as analyticsPresent } from './analytics-present.js';
import { check as consentMechanism } from './consent-mechanism.js';
import { check as ttfb } from './ttfb.js';
import { check as pageWeight } from './page-weight.js';
import { check as largestImage } from './largest-image.js';
import { check as renderBlocking } from './render-blocking.js';

/** Every remote (passive + verified) check module, keyed by catalogue id. */
export const REMOTE_CHECKS: CheckModule[] = [
  tlsValid,
  tlsExpiry,
  httpsRedirect,
  hsts,
  csp,
  cspStrength,
  xFrameOptions,
  xContentTypeOptions,
  referrerPolicy,
  permissionsPolicy,
  cookieFlags,
  corsWildcardCredentials,
  serverLeak,
  sourceMaps,
  secretsInBundle,
  supabaseRestExposed,
  firebaseConfig,
  stripeTestKeyInProd,
  aiLeftovers,
  exposedEnvFiles,
  exposedGit,
  exposedInternalFiles,
  openAdminRoutes,
  supabaseAnonRowRead,
  storageBucketListing,
  rateLimit,
  spf,
  dkim,
  dmarc,
  mx,
  authSenderAuthenticated,
  nameservers,
  dnssec,
  caa,
  domainExpiry,
  securityTxt,
  legalPages,
  title,
  metaDescription,
  canonical,
  h1,
  langViewport,
  ogImage,
  jsonLd,
  robotsTxt,
  sitemap,
  notFoundPage,
  favicon,
  mixedContent,
  brokenLinksHome,
  llmsTxt,
  aiCrawlerPolicy,
  analyticsPresent,
  consentMechanism,
  ttfb,
  pageWeight,
  largestImage,
  renderBlocking,
];

export const REMOTE_CHECK_MAP: Map<string, CheckModule> = new Map(REMOTE_CHECKS.map((c) => [c.id, c]));
