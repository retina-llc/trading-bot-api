import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { UserService } from "../api/user/user-service";

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  // Validate user credentials
  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.userService.findByEmail(email);
    if (user && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user; // Exclude password from the result
      return result;
    }
    return null;
  }

  // Generate JWT token
  async login(user: any) {
    const payload = {
      id: user.id, // Include user ID explicitly
      email: user.email,
    };

    console.log("[AuthService] Signing JWT for user:", user.email);

    return {
      access_token: this.jwtService.sign(payload, {
        secret: process.env.JWT_SECRET || "defaultSecretKey", // Ensure the secret matches your environment
        expiresIn: "1h", // Optional: Set token expiration time
      }),
    };
  }
}
