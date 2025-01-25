// src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UserService } from "../api/user/user-service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private configService: ConfigService,
    private usersService: UserService, // Inject UsersService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("JWT_SECRET") || "your_secret_key",
    });
  }

  async validate(payload: any) {
    this.logger.log(`Validating payload: ${JSON.stringify(payload)}`);

    const userId = payload.id; // Use 'id' instead of 'sub'

    const user = await this.usersService.findOneById(userId);
    if (!user) {
      this.logger.warn(`User with id ${userId} not found`);
      throw new UnauthorizedException("User not found");
    }

    this.logger.log(`User found: ${JSON.stringify(user)}`);

    // Return a subset of the user object as needed
    return { id: user.id, email: user.email };
  }
}
