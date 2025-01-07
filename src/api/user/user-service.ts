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

  // Find user by email
  async findByEmail(email: string): Promise<any> {
    console.log('[UserService] Finding user by email:', email);
    return this.userRepository.findByEmail(email);
  }

  // Sign up a new user
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

  // Fetch user profile by email
  async getUserProfile(email: string): Promise<any> {
    console.log('[UserService]: Fetching profile for email:', email);
  
    const user = await this.findByEmail(email);
    console.log('[UserService]: Query completed. User found:', user ? 'Yes' : 'No');
  
    if (!user) {
      console.error('[UserService]: User not found for email:', email);
      throw new Error('User not found');
    }
  
    // Exclude sensitive info like password
    const { password, ...userProfile } = user;
    console.log('[UserService]: Returning user profile without password:', userProfile);
  
    return userProfile;
  }

  // ========== DELETE USER PROFILE ==========
  /**
   * deleteUserProfile: deletes the user by ID or email
   * returns true if successful, false otherwise
   */
  async deleteUserProfile(email: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    if (!user) {
      return false; // user not found
    }
  
    const result = await this.userRepository.delete(user.id);
    // Safely handle 'affected' if it's null or undefined
    return (result.affected ?? 0) > 0;
  }
}  