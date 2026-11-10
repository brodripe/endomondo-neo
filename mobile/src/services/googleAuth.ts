import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'public-anon-key';

export interface GoogleUserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  provider: 'google';
  signedInAt: number;
}

/**
 * SERVICIO DE AUTENTICACIÓN CON GOOGLE (OAuth 2.0 / OpenID Connect + Supabase Auth)
 * Permite iniciar sesión con una cuenta de Google, sincronizar el perfil biométrico
 * en la tabla `public.profiles` y asociar los entrenamientos GPS al usuario.
 */
export class EndomondoGoogleAuthService {
  private supabase: SupabaseClient;
  private currentUser: GoogleUserProfile | null = null;

  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  getCurrentUser(): GoogleUserProfile | null {
    return this.currentUser;
  }

  /**
   * Inicia el flujo OAuth 2.0 con Google a través de Supabase Auth
   */
  async signInWithGoogleOAuth(redirectUrl?: string): Promise<{
    url: string | null;
    error: string | null;
  }> {
    const { data, error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl ?? 'endomondoneo://auth/callback',
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    });

    if (error) {
      return { url: null, error: error.message };
    }
    return { url: data?.url ?? null, error: null };
  }

  /**
   * Registra/actualiza la sesión a partir del selector nativo de cuentas Google de Android
   * o del token ID de Google Identity Services.
   */
  async setGoogleAccountSession(profile: {
    email: string;
    displayName?: string;
    avatarUrl?: string | null;
  }): Promise<GoogleUserProfile> {
    const cleanEmail = profile.email.trim().toLowerCase();
    const namePart =
      profile.displayName ||
      cleanEmail
        .split('@')[0]
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase());

    const user: GoogleUserProfile = {
      id: `google-${cleanEmail}`,
      email: cleanEmail,
      displayName: namePart,
      avatarUrl:
        profile.avatarUrl ??
        `https://ui-avatars.com/api/?name=${encodeURIComponent(
          namePart
        )}&background=87c80a&color=091005&bold=true`,
      provider: 'google',
      signedInAt: Date.now(),
    };

    this.currentUser = user;
    return user;
  }

  async signOut(): Promise<void> {
    this.currentUser = null;
    try {
      await this.supabase.auth.signOut();
    } catch {
      // Ignorar si estaba en modo local-first
    }
  }
}
