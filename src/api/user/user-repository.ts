import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user-entity';

@Injectable()
export class UserRepository extends Repository<User> {
  constructor(
    @InjectRepository(User)
    private readonly baseRepository: Repository<User>, // Inject the repository
  ) {
    super(baseRepository.target, baseRepository.manager, baseRepository.queryRunner);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ where: { email } });
  }

  async findUserByWallet(walletAddress: string): Promise<User | null> {
    return this.findOne({ where: { wallet_address: walletAddress } });
  }

  async updateSubscriptionStatus(userId: number, status: boolean, subscriptionExpiry?: Date): Promise<void> {
    const updateData: Partial<User> = { has_subscription: status };

    // Add expiry date if provided
    if (subscriptionExpiry) {
      updateData.subscription_expiry = subscriptionExpiry;
    }

    await this.update(userId, updateData);
  }
}
