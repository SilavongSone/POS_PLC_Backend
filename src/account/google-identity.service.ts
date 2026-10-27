import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import type { Env } from '../config/env.js';

export type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

/** Checks Google ID tokens ("Sign in with Google") against Google's keys and our client ids. */
@Injectable()
export class GoogleIdentityService {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService<Env, true>) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    const audience = this.config.get('GOOGLE_CLIENT_IDS', { infer: true });
    if (!audience.length) {
      throw new ForbiddenException({
        message: 'Sign in with Google is not enabled',
        code: 'GOOGLE_DISABLED',
      });
    }
    let payload;
    try {
      payload = (
        await this.client.verifyIdToken({ idToken, audience })
      ).getPayload();
    } catch {
      payload = undefined;
    }
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException({
        message: 'Google sign-in failed',
        code: 'GOOGLE_TOKEN_INVALID',
      });
    }
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name ?? payload.email,
    };
  }
}
