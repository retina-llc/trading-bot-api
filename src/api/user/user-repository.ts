import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between, LessThanOrEqual } from "typeorm";
import { User } from "./user-entity";

@Injectable()
export class UserRepository {
  private readonly logger = new Logger(UserRepository.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>, // Inject Repository<User>
  ) {}

  // Delegate 'create' method
  create(userData: Partial<User>): User {
    this.logger.log(
      `Creating a new user with data: ${JSON.stringify(userData)}`,
    );
    return this.userRepository.create(userData); // Delegate to TypeORM Repository
  }

  // Delegate 'save' method
  async save(user: User): Promise<User> {
    this.logger.log(`Saving user: ${JSON.stringify(user)}`);
    return this.userRepository.save(user); // Delegate to TypeORM Repository
  }

  // Delegate 'delete' method
  async delete(userId: number): Promise<any> {
    this.logger.log(`Deleting user with ID: ${userId}`);
    return this.userRepository.delete(userId); // Delegate to TypeORM Repository
  }
  async findOne(options: any): Promise<User | null> {
    this.logger.log(
      `Finding one user with options: ${JSON.stringify(options)}`,
    );
    return this.userRepository.findOne(options);
  }
  /**
   * Finds a user by their email address.
   * @param email - The email address of the user.
   * @returns The user if found, otherwise null.
   */
  async findByEmail(email: string): Promise<User | null> {
    try {
      this.logger.log(`Searching for user with email: ${email}`);
      const user = await this.userRepository.findOne({ where: { email } }); // Use injected repository
      if (!user) {
        this.logger.warn(`No user found with email: ${email}`);
      }
      return user;
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
      this.logger.log(
        `Searching for user with wallet address: ${walletAddress}`,
      );
      const user = await this.userRepository.findOne({
        where: { wallet_address: walletAddress },
      });
      if (!user) {
        this.logger.warn(`No user found with wallet address: ${walletAddress}`);
      }
      return user;
    } catch (error) {
      this.logger.error(
        `Error finding user by wallet (${walletAddress}):`,
        error,
      );
      throw error;
    }
  }

  /**
   * Updates a user's subscription status and optionally their subscription expiry date.
   * @param userId - The ID of the user.
   * @param status - The new subscription status.
   * @param subscriptionExpiry - (Optional) The new subscription expiry date.
   */
  async updateSubscriptionStatus(
    userId: number,
    status: boolean,
    subscriptionExpiry?: Date,
  ): Promise<void> {
    try {
      this.logger.log(
        `Updating subscription status for user ID: ${userId} to ${status}`,
      );
      const updateData: Partial<User> = { has_subscription: status };

      if (subscriptionExpiry) {
        updateData.subscription_expiry = subscriptionExpiry;
        this.logger.log(
          `Setting new subscription expiry date: ${subscriptionExpiry.toISOString()}`,
        );
      }

      await this.userRepository.update(userId, updateData); // Use injected repository
      this.logger.log(
        `Subscription status updated successfully for user ID: ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error updating subscription status for user ID (${userId}):`,
        error,
      );
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
      this.logger.log(
        `Finding users with subscriptions expiring on: ${targetDate.toISOString().split("T")[0]}`,
      );
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const users = await this.userRepository.find({
        where: {
          has_subscription: true,
          subscription_expiry: Between(startOfDay, endOfDay),
        },
      }); // Use injected repository
      this.logger.log(
        `Found ${users.length} user(s) with subscriptions expiring on ${targetDate.toISOString().split("T")[0]}`,
      );
      return users;
    } catch (error) {
      this.logger.error(
        `Error finding subscriptions expiring on ${targetDate.toISOString()}:`,
        error,
      );
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
      this.logger.log(
        `Finding users with subscriptions expired on or before: ${targetDate.toISOString().split("T")[0]}`,
      );
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const users = await this.userRepository.find({
        where: {
          has_subscription: true,
          subscription_expiry: LessThanOrEqual(endOfDay),
        },
      }); // Use injected repository
      this.logger.log(
        `Found ${users.length} user(s) with subscriptions expired on or before ${targetDate.toISOString().split("T")[0]}`,
      );
      return users;
    } catch (error) {
      this.logger.error(
        `Error finding subscriptions expired on or before ${targetDate.toISOString()}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Finds a user by their ID.
   * @param id - The ID of the user.
   * @returns The user if found, otherwise null.
   */
  async findById(id: number): Promise<User | null> {
    try {
      this.logger.log(`Searching for user with ID: ${id}`);
      const user = await this.userRepository.findOne({ where: { id } }); // Use injected repository
      if (!user) {
        this.logger.warn(`No user found with ID: ${id}`);
      }
      return user;
    } catch (error) {
      this.logger.error(`Error finding user by ID (${id}):`, error);
      throw error;
    }
  }

  async findExpiredSubscriptions(): Promise<User[]> {
    return this.userRepository.createQueryBuilder('user')
      .where('user.subscription_expiry < :now', { now: new Date() })
      .andWhere('user.has_subscription = :active', { active: true })
      .getMany();
  }
}
