import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt'; // Import Strategy and ExtractJwt
import { ConfigService } from '@nestjs/config'; 

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // Enforce token expiration
      secretOrKey: configService.get<string>('JWT_SECRET') || 'defaultSecret',
    });
    console.log('[JwtStrategy] Initialized with secret key.');
  }

  async validate(payload: any) {
    console.log('[JwtStrategy] Validating payload:', payload);
    return { userId: payload.sub, email: payload.email };
  }
}
