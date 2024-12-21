import { Injectable } from '@nestjs/common';
import { UserRepository } from './user/user-repository';

@Injectable()
export class ApiService {
  constructor(private readonly userRepository: UserRepository) {}

  async saveKeysForUser(userId: number, keys: any) {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new Error('User not found');
    }

    user.apiKeys = {
      ...user.apiKeys,
      ...keys, // Update all keys, including monitoringApiMemo
    };
    await this.userRepository.save(user);
  }

  async getKeysForUser(userId: number) {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new Error('User not found');
    }

    return user.apiKeys;
  }

  async deleteKeysForUser(userId: number) {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new Error('User not found');
    }

    user.apiKeys = {}; // Clear the apiKeys field
    await this.userRepository.save(user);
  }
}
