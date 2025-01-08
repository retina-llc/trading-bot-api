// src/email/email-service.ts

import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(EmailService.name);

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  /**
   * Send Welcome Email
   */
  async sendWelcomeEmail(to: string): Promise<void> {
    const mailOptions = {
      from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
      to,
      subject: 'Welcome to Ascari Trading Bot!',
      html: this.getWelcomeTemplate(),
    };

    try {
      this.logger.log(`Sending welcome email to: ${to}`);
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Welcome email sent successfully to: ${to}`);
    } catch (error) {
      this.logger.error(`Error sending welcome email to ${to}:`, (error as Error).message);
      throw new Error('Failed to send welcome email');
    }
  }

  /**
   * Send Subscription Confirmation Email
   */
  async sendSubscriptionEmail(to: string, expiryDate: string): Promise<void> {
    const mailOptions = {
      from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
      to,
      subject: 'Subscription Confirmation - Ascari Trading Bot',
      html: this.getSubscriptionTemplate(expiryDate),
    };

    try {
      this.logger.log(`Sending subscription confirmation email to: ${to}`);
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Subscription confirmation email sent successfully to: ${to}`);
    } catch (error) {
      this.logger.error(`Error sending subscription email to ${to}:`, (error as Error).message);
      throw new Error('Failed to send subscription email');
    }
  }

  /**
   * Send Partial Payment Email
   */
  async sendPartialPaymentEmail(
    to: string,
    currentBalanceUsd: number,
    missingAmountUsd: number,
    missingAsc: number
  ): Promise<void> {
    const subject = 'Partial Payment Received - Ascari Trading Bot';
    const mailHtml = this.getPartialPaymentTemplate(currentBalanceUsd, missingAmountUsd, missingAsc);

    const mailOptions = {
      from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
      to,
      subject,
      html: mailHtml,
    };

    try {
      this.logger.log(`Sending partial payment email to: ${to}`);
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Partial payment email sent successfully to: ${to}`);
    } catch (error) {
      this.logger.error(`Error sending partial payment email to ${to}:`, (error as Error).message);
      throw new Error('Failed to send partial payment email');
    }
  }

  /**
   * Send Pre-Expiry Notification Email
   */
  async sendPreExpiryEmail(
    to: string,
    subscriptionExpiry: Date,
    currentCreditUsd: number,
    currentCreditAsc: number,
    requiredUsd: number,
    requiredAsc: number
  ): Promise<void> {
    const formattedExpiry = subscriptionExpiry.toISOString().split('T')[0];
    const mailOptions = {
      from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
      to,
      subject: 'Your Subscription is About to Expire',
      html: this.getPreExpiryTemplate(formattedExpiry, currentCreditUsd, currentCreditAsc, requiredUsd, requiredAsc),
    };

    try {
      this.logger.log(`Sending pre-expiry notification email to: ${to}`);
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Pre-expiry notification email sent successfully to: ${to}`);
    } catch (error) {
      this.logger.error(`Error sending pre-expiry notification email to ${to}:`, (error as Error).message);
      throw new Error('Failed to send pre-expiry notification email');
    }
  }

  /**
   * Send Subscription Renewed Email
   */
  async sendSubscriptionRenewedEmail(
    to: string,
    newExpiry: Date,
    remainingUsd: number,
    remainingAsc: number
  ): Promise<void> {
    const formattedExpiry = newExpiry.toISOString().split('T')[0];
    const mailOptions = {
      from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
      to,
      subject: 'Your Subscription Has Been Renewed',
      html: this.getSubscriptionRenewedTemplate(formattedExpiry, remainingUsd, remainingAsc),
    };

    try {
      this.logger.log(`Sending subscription renewed email to: ${to}`);
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Subscription renewed email sent successfully to: ${to}`);
    } catch (error) {
      this.logger.error(`Error sending subscription renewed email to ${to}:`, (error as Error).message);
      throw new Error('Failed to send subscription renewed email');
    }
  }

  /**
   * Send Subscription Deactivated Email
   */
  async sendSubscriptionDeactivatedEmail(
    to: string,
    missingUsd: number,
    missingAsc: number
  ): Promise<void> {
    const mailOptions = {
      from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
      to,
      subject: 'Your Subscription Has Been Deactivated',
      html: this.getSubscriptionDeactivatedTemplate(missingUsd, missingAsc),
    };

    try {
      this.logger.log(`Sending subscription deactivated email to: ${to}`);
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Subscription deactivated email sent successfully to: ${to}`);
    } catch (error) {
      this.logger.error(`Error sending subscription deactivated email to ${to}:`, (error as Error).message);
      throw new Error('Failed to send subscription deactivated email');
    }
  }

  /**
   * Send Credit Remaining Email after Renewal
   */
  async sendCreditRemainingEmail(
    to: string,
    remainingUsd: number,
    remainingAsc: number
  ): Promise<void> {
    const mailOptions = {
      from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
      to,
      subject: 'Subscription Renewal Successful - Remaining Credits',
      html: this.getCreditRemainingTemplate(remainingUsd, remainingAsc),
    };

    try {
      this.logger.log(`Sending credit remaining email to: ${to}`);
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Credit remaining email sent successfully to: ${to}`);
    } catch (error) {
      this.logger.error(`Error sending credit remaining email to ${to}:`, (error as Error).message);
      throw new Error('Failed to send credit remaining email');
    }
  }

  /**
   * Generic Send Email Method (Optional)
   * Can be used for sending custom emails if needed
   */
  async sendEmail(options: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
  }): Promise<void> {
    const mailOptions = {
      from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    try {
      this.logger.log(`Sending generic email to: ${options.to}`);
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Generic email sent successfully to: ${options.to}`);
    } catch (error) {
      this.logger.error(`Error sending generic email to ${options.to}:`, (error as Error).message);
      throw new Error('Failed to send generic email');
    }
  }

  /**
   * Email Templates
   */

  private getWelcomeTemplate(): string {
    return `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h1>Welcome to Ascari Trading Bot!</h1>
        <p>We're excited to have you on board. Start exploring the trading features now.</p>
        <a href="https://ascaritradingbot.com" style="padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Get Started</a>
      </div>
    `;
  }

  private getSubscriptionTemplate(expiryDate: string): string {
    return `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h1>Subscription Activated!</h1>
        <p>Your subscription has been successfully activated. 🎉</p>
        <p><strong>Subscription Expiry Date:</strong> ${expiryDate}</p>
        <p>Enjoy the full features of Ascari Trading Bot!</p>
        <a href="https://ascaritradingbot.com" style="padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Explore Features</a>
      </div>
    `;
  }

  private getPartialPaymentTemplate(
    currentBalanceUsd: number,
    missingAmountUsd: number,
    missingAsc: number
  ): string {
    const missingAscFixed = missingAsc.toFixed(4); // e.g., 4 decimal places

    return `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h1>Partial Payment Received</h1>
        <p>
          We have received a partial payment of <strong>$${currentBalanceUsd.toFixed(2)}</strong> so far.
        </p>
        <p>
          You still need <strong>$${missingAmountUsd.toFixed(2)}</strong> more to reach the required $10.00 
          to activate your subscription.
        </p>
        <p>
          That is approximately <strong>${missingAscFixed} ASC</strong> at current prices.
        </p>
        <p>
          Please send the remaining amount from your registered wallet address to complete your subscription.
        </p>
      </div>
    `;
  }

  private getPreExpiryTemplate(
    expiryDate: string,
    currentCreditUsd: number,
    currentCreditAsc: number,
    requiredUsd: number,
    requiredAsc: number
  ): string {
    return `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h1>Your Subscription is About to Expire</h1>
        <p>Your subscription will expire on <strong>${expiryDate}</strong>, which is in 3 days.</p>
        <p><strong>Current Credit Balance:</strong> $${currentCreditUsd.toFixed(2)} (${currentCreditAsc.toFixed(4)} ASC)</p>
        <p><strong>Required for Renewal:</strong> $${requiredUsd.toFixed(2)} (${requiredAsc.toFixed(4)} ASC)</p>
        <p>If you have sufficient credits, your subscription will be renewed automatically on the expiry date.</p>
        <p>If not, please make a payment to continue enjoying our services without interruption.</p>
        <a href="https://ascaritradingbot.com" style="padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Manage Subscription</a>
      </div>
    `;
  }

  private getSubscriptionRenewedTemplate(
    newExpiry: string,
    remainingUsd: number,
    remainingAsc: number
  ): string {
    return `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h1>Your Subscription Has Been Renewed</h1>
        <p>Your subscription has been successfully renewed and is now active until <strong>${newExpiry}</strong>.</p>
        <p><strong>Remaining Credit Balance:</strong> $${remainingUsd.toFixed(2)} (${remainingAsc.toFixed(4)} ASC)</p>
        <p>Thank you for continuing to use Ascari Trading Bot!</p>
        <a href="https://ascaritradingbot.com" style="padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Explore Features</a>
      </div>
    `;
  }

  private getSubscriptionDeactivatedTemplate(
    missingUsd: number,
    missingAsc: number
  ): string {
    return `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h1>Your Subscription Has Been Deactivated</h1>
        <p>We're sorry to inform you that your subscription has been deactivated due to insufficient credits.</p>
        <p><strong>Amount Missing:</strong> $${missingUsd.toFixed(2)} (${missingAsc.toFixed(4)} ASC)</p>
        <p>Please make a payment to reactivate your subscription and continue enjoying our services.</p>
        <a href="https://ascaritradingbot.com" style="padding: 10px 20px; background-color: #f44336; color: white; text-decoration: none; border-radius: 5px;">Reactivate Subscription</a>
      </div>
    `;
  }

  private getCreditRemainingTemplate(
    remainingUsd: number,
    remainingAsc: number
  ): string {
    return `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h1>Subscription Renewal Successful</h1>
        <p>Your subscription has been successfully renewed and is now active for another month.</p>
        <p><strong>Remaining Credit Balance:</strong> $${remainingUsd.toFixed(2)} (${remainingAsc.toFixed(4)} ASC)</p>
        <p>Thank you for using Ascari Trading Bot!</p>
        <a href="https://ascaritradingbot.com" style="padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Explore Features</a>
      </div>
    `;
  }
}
