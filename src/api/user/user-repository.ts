// src/user/user-repository.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual } from 'typeorm';
import { User } from './user-entity';

@Injectable()
export class UserRepository extends Repository<User> {
  private readonly logger = new Logger(UserRepository.name);

  constructor(
    @InjectRepository(User)
    private readonly baseRepository: Repository<User>, // Inject the repository
  ) {
    super(baseRepository.target, baseRepository.manager, baseRepository.queryRunner);
  }

  /**
   * Finds a user by their email address.
   * @param email - The email address of the user.
   * @returns The user if found, otherwise null.
   */
  async findByEmail(email: string): Promise<User | null> {
    try {
      this.logger.log(`Searching for user with email: ${email}`);
      const user = await this.findOne({ where: { email } });
      if (!user) {
        this.logger.warn(`No user found with email: ${email}`);
      }
      return user || null;
    } catch (error) {
      this.logger.error(`Error finding user by email (${email}):`, error);
      throw error;
    }
  }

  /**
   * Finds a user by their wallet address.
   * @param walletAddress - The wallet address of the user.
   * @returns The user if found, otherwise null.
   */
  async findUserByWallet(walletAddress: string): Promise<User | null> {
    try {
      this.logger.log(`Searching for user with wallet address: ${walletAddress}`);
      const user = await this.findOne({ where: { wallet_address: walletAddress } });
      if (!user) {
        this.logger.warn(`No user found with wallet address: ${walletAddress}`);
      }
      return user || null;
    } catch (error) {
      this.logger.error(`Error finding user by wallet (${walletAddress}):`, error);
      throw error;
    }
  }

  /**
   * Updates a user's subscription status and optionally their subscription expiry date.
   * @param userId - The ID of the user.
   * @param status - The new subscription status (true for active, false for inactive).
   * @param subscriptionExpiry - (Optional) The new subscription expiry date.
   */
  async updateSubscriptionStatus(
    userId: number,
    status: boolean,
    subscriptionExpiry?: Date,
  ): Promise<void> {
    try {
      this.logger.log(`Updating subscription status for user ID: ${userId} to ${status}`);
      
      const updateData: Partial<User> = { has_subscription: status };

      if (subscriptionExpiry) {
        updateData.subscription_expiry = subscriptionExpiry;
        this.logger.log(`Setting new subscription expiry date: ${subscriptionExpiry.toISOString()}`);
      }

      await this.update(userId, updateData);
      this.logger.log(`Subscription status updated successfully for user ID: ${userId}`);
    } catch (error) {
      this.logger.error(`Error updating subscription status for user ID (${userId}):`, error);
      throw error;
    }
  }

  /**
   * Finds users with subscriptions expiring on a specific date.
   * @param targetDate - The date to match subscription expiries.
   * @returns An array of users whose subscriptions expire on the target date.
   */
  async findSubscriptionsExpiringOn(targetDate: Date): Promise<User[]> {
    try {
      this.logger.log(`Finding users with subscriptions expiring on: ${targetDate.toISOString().split('T')[0]}`);
      
      // Normalize the target date to cover the entire day
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const users = await this.find({
        where: {
          has_subscription: true,
          subscription_expiry: Between(startOfDay, endOfDay),
        },
      });

      this.logger.log(`Found ${users.length} user(s) with subscriptions expiring on ${targetDate.toISOString().split('T')[0]}`);
      return users;
    } catch (error) {
      this.logger.error(`Error finding subscriptions expiring on ${targetDate.toISOString()}:`, error);
      throw error;
    }
  }

  /**
   * Finds users with subscriptions expired on or before a specific date.
   * @param targetDate - The date to check for expired subscriptions.
   * @returns An array of users whose subscriptions have expired on or before the target date.
   */
  async findSubscriptionsExpiredOnOrBefore(targetDate: Date): Promise<User[]> {
    try {
      this.logger.log(`Finding users with subscriptions expired on or before: ${targetDate.toISOString().split('T')[0]}`);
      
      // Normalize the target date to include the entire day
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const users = await this.find({
        where: {
          has_subscription: true,
          subscription_expiry: LessThanOrEqual(endOfDay),
        },
      });

      this.logger.log(`Found ${users.length} user(s) with subscriptions expired on or before ${targetDate.toISOString().split('T')[0]}`);
      return users;
    } catch (error) {
      this.logger.error(`Error finding subscriptions expired on or before ${targetDate.toISOString()}:`, error);
      throw error;
    }
  }
}
