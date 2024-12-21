// src/auth/local.strategy.ts
import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' }); // Use 'email' instead of default 'username'
    console.log('[LocalStrategy] Initialized.');
  }

  async validate(email: string, password: string): Promise<any> {
    console.log('[LocalStrategy] Validating user:', email);
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      console.error('[LocalStrategy] Validation failed for user:', email);
      throw new UnauthorizedException();
    }
    console.log('[LocalStrategy] Validation successful for user:', email);
    return user;
  }
}
