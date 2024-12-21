import { JsonRpcProvider, Contract, formatUnits } from 'ethers'; // Correct imports for ethers v6.x
import { Injectable } from '@nestjs/common';
import { UserRepository } from '../user/user-repository';
import { EmailService } from '../email/email-service';

@Injectable()
export class SubscriptionService {
  private provider: JsonRpcProvider;
  private walletAddress: string;
  private tmcContractAddress: string;
  private tmcABI: any;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly emailService: EmailService, // Inject EmailService
  ) {
    // Setup provider and wallet
    this.provider = new JsonRpcProvider('https://sepolia.infura.io/v3/9de0180f470d430485e9963b80d203f6');
    this.walletAddress = '0x121fec926152A209e8f20f78d875335402C1bA98'; // Replace with the wallet address to receive TMC
    this.tmcContractAddress = '0xBEC3e1D4Ff1Cd1006624a07988b25Cc0eA03190f'; // Replace with the TMC contract address
    this.tmcABI = ["event Transfer(address indexed from, address indexed to, uint256 value)"];
  }

  // Start listening for transactions
  async startListening(): Promise<void> {
    console.log('SubscriptionService: Listening for TMC transfers...');
    const contract = new Contract(this.tmcContractAddress, this.tmcABI, this.provider);

    contract.on('Transfer', async (from: string, to: string, value: bigint) => {
      if (to.toLowerCase() === this.walletAddress.toLowerCase()) {
        const amount = formatUnits(value, 18); // Convert BigInt value to human-readable format
        console.log(`Received TMC transfer from ${from}. Amount: ${amount}`);

        // Check if the transfer is sufficient
        const requiredAmount = 10; // Fixed $10 for testing
        if (parseFloat(amount) >= requiredAmount) {
          console.log('Valid transaction detected. Granting subscription...');
          await this.grantSubscription(from); // Grant subscription
        } else {
          console.log('Transaction amount is insufficient for subscription.');
        }
      }
    });
  }

  private async grantSubscription(senderAddress: string): Promise<void> {
    try {
      const user = await this.userRepository.findUserByWallet(senderAddress);
      if (!user) {
        console.log('No user found with the given wallet address.');
        return;
      }
  
      // Check if the user is already subscribed and their subscription has not expired
      if (
        user.has_subscription &&
        user.subscription_expiry &&
        user.subscription_expiry > new Date()
      ) {
        console.log(`User ${user.email} is already subscribed until ${user.subscription_expiry}. Payment rejected.`);
        return; // Exit without granting a new subscription
      }
  
      // Set subscription expiry date (1 month from now)
      const subscriptionExpiry = new Date();
      subscriptionExpiry.setMonth(subscriptionExpiry.getMonth() + 1);
  
      // Update subscription status and expiry
      await this.userRepository.updateSubscriptionStatus(user.id, true, subscriptionExpiry);
      console.log(`Subscription granted to user: ${user.email}, expires on: ${subscriptionExpiry}`);
  
      // Send subscription confirmation email
      const formattedExpiry = subscriptionExpiry.toISOString().split('T')[0]; // Format as YYYY-MM-DD
      await this.emailService.sendSubscriptionEmail(user.email, formattedExpiry);
    } catch (error) {
      console.error('Error granting subscription:', (error as Error).message);
    }
  }
}  