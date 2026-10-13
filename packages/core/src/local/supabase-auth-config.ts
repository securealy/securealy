import { result } from '../checks/context.js';
import type { LocalCheckModule } from './context.js';
import { supabaseRefFromUrl } from './context.js';

interface AuthConfig {
  disable_signup?: boolean;
  external_anonymous_users_enabled?: boolean;
  password_min_length?: number;
  password_required_characters?: string;
  mailer_otp_exp?: number;
  uri_allow_list?: string;
  site_url?: string;
  security_captcha_enabled?: boolean;
  mailer_autoconfirm?: boolean;
}

export const check: LocalCheckModule = {
  id: 'supabase-auth-config',
  async run(ctx) {
    const token = ctx.envAny('SUPABASE_MGMT_TOKEN', 'SUPABASE_ACCESS_TOKEN');
    const ref = ctx.env('SUPABASE_PROJECT_REF') ?? supabaseRefFromUrl(ctx.envAny('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL', 'PUBLIC_SUPABASE_URL'));
    if (!token) return result(this.id, 'skip', 'SUPABASE_MGMT_TOKEN not set; a management token is needed to read auth settings');
    if (!ref) return result(this.id, 'skip', 'no project ref: set SUPABASE_PROJECT_REF or SUPABASE_URL');
    let res: Response;
    try {
      res = await ctx.fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/config/auth`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    } catch (e) {
      return result(this.id, 'error', `management API unreachable: ${(e as Error).message}`.slice(0, 160));
    }
    if (res.status === 401 || res.status === 403) return result(this.id, 'error', `management API refused the token (${res.status}); it needs access to project ${ref}`);
    if (!res.ok) return result(this.id, 'error', `management API answered ${res.status} for project ${ref}`);
    const cfg = (await res.json()) as AuthConfig;
    const fails: string[] = [];
    const warns: string[] = [];
    const notes: string[] = [];
    const minLen = cfg.password_min_length ?? 6;
    if (minLen < 12) fails.push(`minimum password length ${minLen} (need 12+)`);
    else notes.push(`password min ${minLen}`);
    if (cfg.external_anonymous_users_enabled) fails.push('anonymous sign-ins enabled');
    const intent = (ctx.env('SECUREALY_SIGNUP') ?? '').toLowerCase();
    if (cfg.disable_signup === false || cfg.disable_signup === undefined) {
      if (intent === 'closed') fails.push('signup is open but SECUREALY_SIGNUP=closed');
      else notes.push('signup open');
    } else notes.push('signup closed');
    const allow = (cfg.uri_allow_list ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allow.length === 0) warns.push('redirect allow-list empty (only site_url accepted; add every login URL you use)');
    else if (allow.some((u) => /^https?:\/\/\*\*?$|^\*\*?$/.test(u))) fails.push('redirect allow-list contains a bare wildcard');
    else notes.push(`${allow.length} redirect URL${allow.length === 1 ? '' : 's'}`);
    const otp = cfg.mailer_otp_exp ?? 3600;
    if (otp > 86_400) warns.push(`OTP expiry ${Math.round(otp / 3600)} h (over a day)`);
    else notes.push(`OTP expiry ${Math.round(otp / 60)} min`);
    if (cfg.mailer_autoconfirm) warns.push('email auto-confirm on (addresses are never verified)');
    if (!cfg.security_captcha_enabled) notes.push('no captcha');
    const text = [...fails, ...warns, ...notes].join('; ');
    if (fails.length) return result(this.id, 'fail', text);
    if (warns.length) return result(this.id, 'warn', text);
    return result(this.id, 'pass', text);
  },
};
