// src/users/user.service.ts
import { Injectable } from '@nestjs/common';
import { UserRepository } from './user-repository';
import * as bcrypt from 'bcrypt';
import { EmailService } from '../email/email-service';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly emailService: EmailService,
  ) {}

  // Add findByEmail method
  async findByEmail(email: string): Promise<any> {
    console.log('[UserService] Finding user by email:', email);
    return this.userRepository.findByEmail(email);
  }

  async signUp(email: string, password: string, wallet_address: string): Promise<any> {
    console.log('UserService: Signing up user with email:', email);

    const existingUser = await this.findByEmail(email);
    if (existingUser) {
      console.error('UserService: User already exists');
      throw new Error('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = this.userRepository.create({
      email,
      password: hashedPassword,
      wallet_address,
    });

    const savedUser = await this.userRepository.save(newUser);
    console.log('UserService: User signed up successfully:', savedUser);

    // Send welcome email
    await this.emailService.sendWelcomeEmail(email);

    return savedUser;
  }

  async getUserProfile(email: string): Promise<any> {
    console.log('[UserService]: Fetching profile for email:', email);
  
    const user = await this.findByEmail(email);
    console.log('[UserService]: Query completed. User found:', user ? 'Yes' : 'No');
  
    if (!user) {
      console.error('[UserService]: User not found for email:', email);
      throw new Error('User not found');
    }
  
    // Exclude sensitive information like password
    const { password, ...userProfile } = user;
    console.log('[UserService]: Returning user profile without password:', userProfile);
  
    return userProfile;
  }
}
