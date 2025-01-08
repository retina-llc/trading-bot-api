import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRepository } from './user-repository';
import * as bcrypt from 'bcrypt';
import { User } from './user.interface'; // Import User interface
import { JwtService } from '@nestjs/jwt'; // Import JwtService

@Injectable()
export class LoginService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    console.log('LoginService: Attempting login for email:', email);

    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    console.log('LoginService: Login successful');

    // Include the `id` in the payload
    const payload = {
      id: user.id, // Include user ID
      email: user.email,
    };

    const token = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET || 'Matthew123$', // Use correct secret
      expiresIn: '1h', // Optional: Set token expiration time
    });

    console.log('LoginService: JWT generated:', token);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        wallet_address: user.wallet_address,
        has_subscription: user.has_subscription,
        partial_usd_balance: user.partial_usd_balance,
      } as User,
    };
  }
}
