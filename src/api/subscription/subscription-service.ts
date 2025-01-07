import { Injectable } from '@nestjs/common';
import { JsonRpcProvider, Contract, formatUnits } from 'ethers';
import axios from 'axios';

import { UserRepository } from '../user/user-repository';
import { EmailService } from '../email/email-service';

@Injectable()
export class SubscriptionService {
  private provider: JsonRpcProvider;
  private walletAddress: string;
  private ascContractAddress: string;
  private ascABI: string[];

  // Uniswap V3 Subgraph endpoint
  private uniswapV3Endpoint = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';
  // The V3 pool for ASC–USDT on mainnet
  private ascUsdtPoolAddress = '0x9DF8f2c89E04C25B6c3636E718dd62d5D16230d9';
  private uniswapV3PoolABI = [
    'function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)'
  ];

  constructor(
    private readonly userRepository: UserRepository,
    private readonly emailService: EmailService,
  ) {
    // 1) Ethereum mainnet provider
    this.provider = new JsonRpcProvider('https://mainnet.infura.io/v3/9de0180f470d430485e9963b80d203f6');

    // 2) Wallet + ASC addresses
    this.walletAddress = '0x121fec926152A209e8f20f78d875335402C1bA98';
    this.ascContractAddress = '0x2B00F09C8958622a89A29Fb23fAA4e405Dfd9bB6';

    // Standard ERC-20 Transfer event ABI
    this.ascABI = [
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ];
  }

  // ========== 1) Listen for ASC transfers on-chain ==========
  async startListening(): Promise<void> {
    console.log('SubscriptionService: Listening for ASC transfers...');

    const contract = new Contract(this.ascContractAddress, this.ascABI, this.provider);

    contract.on('Transfer', async (from: string, to: string, value: bigint) => {
      // Check if ASC was sent to our designated wallet
      if (to.toLowerCase() === this.walletAddress.toLowerCase()) {
        // Convert BigInt to decimal string (ASC typically 18 decimals)
        const ascAmount = parseFloat(formatUnits(value, 18));
        console.log(`Received ASC transfer from ${from}. Amount: ${ascAmount}`);

        // Convert ASC amount to approximate USD via Uniswap V3
        const amountInUSD = await this.getAscValueInUSD(ascAmount);
        console.log(`Equivalent USD (approx): $${amountInUSD.toFixed(2)}`);

        // Attempt to accumulate partial payments
        await this.handlePartialPayment(from, amountInUSD);
      }
    });
  }

  /**
   * handlePartialPayment:
   *  - Finds the user by wallet
   *  - Increments partial_usd_balance
   *  - If partial_usd_balance >= $10, grant subscription
   *  - Otherwise, send email about how much is missing
   */
  private async handlePartialPayment(senderAddress: string, amountInUSD: number): Promise<void> {
    const requiredUsdAmount = 10; // $10 for subscription
  
    try {
      const user = await this.userRepository.findUserByWallet(senderAddress);
      if (!user) {
        console.log(`No user found with wallet ${senderAddress}. Ignoring payment.`);
        return;
      }
  
      // Already subscribed? skip...
      if (
        user.has_subscription &&
        user.subscription_expiry &&
        user.subscription_expiry > new Date()
      ) {
        console.log(`User ${user.email} is already subscribed. Payment ignored.`);
        return;
      }
  
      // Accumulate partial balance
      const oldBalance = user.partial_usd_balance || 0;
      const newBalance = Number(oldBalance) + amountInUSD;
      console.log(`User ${user.email} partial balance old: $${oldBalance}, adding: $${amountInUSD}, new: $${newBalance}`);
  
      if (newBalance >= requiredUsdAmount) {
        // Over $10 => grant subscription
        user.partial_usd_balance = 0;
        await this.userRepository.save(user);
  
        await this.grantSubscription(senderAddress);
      } else {
        // under $10 => send partial payment email
        user.partial_usd_balance = newBalance;
        await this.userRepository.save(user);
  
        const missingUsd = requiredUsdAmount - newBalance;
        console.log(`Still under $10. Missing: $${missingUsd.toFixed(2)}`);
  
        // ===== NEW: Calculate missing ASC for $X missingUsd =====
        // 1) Price of 1 ASC in USD
        const priceOfOneAsc = await this.getAscValueInUSD(1);
        
        // 2) How many ASC = missingUsd / priceOfOneAsc
        let missingAsc = 0;
        if (priceOfOneAsc > 0) {
          missingAsc = missingUsd / priceOfOneAsc;
        }
  
        await this.emailService.sendPartialPaymentEmail(user.email, newBalance, missingUsd, missingAsc);
      }
    } catch (err) {
      console.error('Error handling partial payment:', err);
    }
  }
  
  // ========== 2) Get ASC Price in USD from Uniswap V3 ==========
  public async getAscValueInUSD(ascAmount: number): Promise<number> {
    try {
      const poolContract = new Contract(
        this.ascUsdtPoolAddress,
        this.uniswapV3PoolABI,
        this.provider
      );
      const token0 = (await poolContract.token0()).toLowerCase();
      const token1 = (await poolContract.token1()).toLowerCase();

      const decimalsAsc = 18;
      const decimalsUsdt = 6;

      const slot0 = await poolContract.slot0();
      const sqrtPriceX96 = slot0[0];

      // Convert BigInt
      const sqrtPrice = BigInt(sqrtPriceX96.toString());
      const Q96 = 1n << 96n;    // 2^96
      const Q192 = 1n << 192n;  // 2^192

      const numerator = sqrtPrice * sqrtPrice; // sqrtPrice^2
      const denominator = Q192;
      let ratio = Number(numerator) / Number(denominator);

      const decimalsFactor = 10 ** (decimalsAsc - decimalsUsdt);
      let priceAscInUsdt = 0;

      if (token0 === this.ascContractAddress.toLowerCase()) {
        // ASC = token0
        priceAscInUsdt = ratio * decimalsFactor;
      } else {
        // ASC = token1 => invert
        const inverseRatio = 1 / ratio;
        const decimalsFactor2 = 10 ** (decimalsUsdt - decimalsAsc);
        priceAscInUsdt = inverseRatio * decimalsFactor2;
      }

      const totalInUsdt = ascAmount * priceAscInUsdt;
      return totalInUsdt;
    } catch (error) {
      console.error('Error reading slot0 from Uniswap V3 pool:', error);
      return 0;
    }
  }

  // ========== 3) Grant Subscription if Payment is Valid ==========
  private async grantSubscription(senderAddress: string): Promise<void> {
    try {
      const user = await this.userRepository.findUserByWallet(senderAddress);
      if (!user) {
        console.log('No user found with the given wallet address.');
        return;
      }

      // If user is already subscribed and not expired yet, reject
      if (
        user.has_subscription &&
        user.subscription_expiry &&
        user.subscription_expiry > new Date()
      ) {
        console.log(
          `User ${user.email} is already subscribed until ${user.subscription_expiry}. Payment rejected.`
        );
        return;
      }

      // Set subscription expiry date to 1 month from now
      const subscriptionExpiry = new Date();
      subscriptionExpiry.setMonth(subscriptionExpiry.getMonth() + 1);

      // Update subscription status and expiry in DB
      await this.userRepository.updateSubscriptionStatus(
        user.id,
        true,
        subscriptionExpiry,
      );
      console.log(
        `Subscription granted to user: ${user.email}, expires on: ${subscriptionExpiry}`,
      );

      // Send subscription confirmation email
      const formattedExpiry = subscriptionExpiry.toISOString().split('T')[0];
      await this.emailService.sendSubscriptionEmail(user.email, formattedExpiry);
    } catch (error) {
      console.error('Error granting subscription:', (error as Error).message);
    }
  }
}
