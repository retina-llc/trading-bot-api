import { Inject, Injectable, NotFoundException, Logger } from "@nestjs/common";
import { UserRepository } from "./user-repository";
import * as bcrypt from "bcrypt";
import { EmailService } from "../email/email-service";
import { User } from "./user-entity";

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name); // Add Logger instance

  constructor(
    @Inject(UserRepository) private readonly userRepository: UserRepository, // Inject the custom repository
    private readonly emailService: EmailService,
  ) {}

  // Find user by email
  async findByEmail(email: string): Promise<User | null> {
    this.logger.log(`[UserService] Finding user by email: ${email}`);
    return this.userRepository.findByEmail(email);
  }

  // Sign up a new user
  async signUp(
    email: string,
    password: string,
    wallet_address: string,
  ): Promise<User> {
    this.logger.log(`UserService: Signing up user with email: ${email}`);

    const existingUser = await this.findByEmail(email);
    if (existingUser) {
      this.logger.error("UserService: User already exists");
      throw new Error("User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Use UserRepository's `create` method
    const newUser = this.userRepository.create({
      email,
      password: hashedPassword,
      wallet_address,
    });

    // Use UserRepository's `save` method
    const savedUser = await this.userRepository.save(newUser);
    this.logger.log(
      `UserService: User signed up successfully: ${JSON.stringify(savedUser)}`,
    );

    // Send welcome email
    await this.emailService.sendWelcomeEmail(email);

    return savedUser;
  }

  // Fetch user profile by email
  async getUserProfile(email: string): Promise<any> {
    this.logger.log(`[UserService]: Fetching profile for email: ${email}`);

    const user = await this.findByEmail(email);
    this.logger.log(
      `[UserService]: Query completed. User found: ${user ? "Yes" : "No"}`,
    );

    if (!user) {
      this.logger.error(`[UserService]: User not found for email: ${email}`);
      throw new NotFoundException("User not found");
    }

    // Exclude sensitive info like password
    const { password, ...userProfile } = user;
    this.logger.log(
      `[UserService]: Returning user profile without password: ${JSON.stringify(userProfile)}`,
    );

    return userProfile;
  }

  // Delete user profile
  async deleteUserProfile(email: string): Promise<boolean> {
    this.logger.log(
      `[UserService]: Attempting to delete user profile for email: ${email}`,
    );
    const user = await this.findByEmail(email);
    if (!user) {
      this.logger.warn(`[UserService]: User not found for email: ${email}`);
      return false;
    }

    // Use UserRepository's `delete` method
    const result = await this.userRepository.delete(user.id);
    this.logger.log(
      `[UserService]: Deletion result for user ID ${user.id}: ${result.affected ?? 0} row(s) affected`,
    );

    return (result.affected ?? 0) > 0;
  }

  // Find a user by ID
  async findOneById(id: number): Promise<User> {
    this.logger.log(`Finding user by ID: ${id}`);
    const user = await this.userRepository.findById(id);
    if (!user) {
      this.logger.warn(`User with ID ${id} not found.`);
      throw new NotFoundException("User not found");
    }
    this.logger.log(`User found: ${JSON.stringify(user)}`);
    return user;
  }
  async resetPassword(email: string, newPassword: string): Promise<boolean> {
    this.logger.log(`UserService: Resetting password for email: ${email}`);
    const user = await this.findByEmail(email);
    if (!user) {
      this.logger.error(`UserService: User not found for email: ${email}`);
      throw new NotFoundException("User not found");
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    const updatedUser = await this.userRepository.save(user);
    this.logger.log(
      `UserService: Password reset successfully for user: ${JSON.stringify(updatedUser)}`,
    );
    // Optionally, send a confirmation email:
    await this.emailService.sendEmail({
      to: email,
      subject: "Your Password Has Been Reset",
      text: "Your password has been reset successfully. If you did not perform this action, please contact support immediately.",
    });
    return true;
  }
}
