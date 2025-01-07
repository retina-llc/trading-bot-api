import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  // Welcome Email
  async sendWelcomeEmail(to: string): Promise<void> {
    const mailOptions = {
      from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
      to,
      subject: 'Welcome to Ascari Trading Bot!',
      html: this.getWelcomeTemplate(),
    };

    try {
      console.log('EmailService: Sending welcome email to:', to);
      await this.transporter.sendMail(mailOptions);
      console.log('EmailService: Welcome email sent successfully');
    } catch (error) {
      console.error('EmailService: Error sending welcome email:', (error as Error).message);
      throw new Error('Failed to send welcome email');
    }
  }

  // Subscription Email
  async sendSubscriptionEmail(to: string, expiryDate: string): Promise<void> {
    const mailOptions = {
      from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
      to,
      subject: 'Subscription Confirmation - Ascari Trading Bot',
      html: this.getSubscriptionTemplate(expiryDate),
    };

    try {
      console.log('EmailService: Sending subscription confirmation email to:', to);
      await this.transporter.sendMail(mailOptions);
      console.log('EmailService: Subscription confirmation email sent successfully');
    } catch (error) {
      console.error('EmailService: Error sending subscription email:', (error as Error).message);
      throw new Error('Failed to send subscription email');
    }
  }

  // EmailService
async sendPartialPaymentEmail(
  to: string, 
  currentBalance: number, 
  missingAmountUsd: number,
  missingAsc: number
): Promise<void> {
  const subject = 'Partial Payment Received - Ascari Trading Bot';
  const mailHtml = this.getPartialPaymentTemplate(currentBalance, missingAmountUsd, missingAsc);

  const mailOptions = {
    from: '"Ascari Trading Bot" <no-reply@ascaritradingbot.com>',
    to,
    subject,
    html: mailHtml,
  };

  try {
    console.log('EmailService: Sending partial payment email to:', to);
    await this.transporter.sendMail(mailOptions);
    console.log('EmailService: Partial payment email sent successfully');
  } catch (error) {
    console.error('EmailService: Error sending partial payment email:', (error as Error).message);
    throw new Error('Failed to send partial payment email');
  }
}

// Now update the template to reflect missingAsc
private getPartialPaymentTemplate(
  currentBalanceUsd: number, 
  missingAmountUsd: number, 
  missingAsc: number
): string {
  // Round missingAsc or format it
  const missingAscFixed = missingAsc.toFixed(4); // e.g. 4 decimal places

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

  private getWelcomeTemplate(): string {
    return `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h1>Welcome to Ascari Trading Bot!</h1>
        <p>We're excited to have you on board. Start exploring the trading features now.</p>
        <a href="https://ascaritradingbot.com" style="padding: 10px; background-color: #4CAF50; color: white; text-decoration: none;">Get Started</a>
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
        <a href="https://ascaritradingbot.com" style="padding: 10px; background-color: #4CAF50; color: white; text-decoration: none;">Explore Features</a>
      </div>
    `;
  }

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
      console.log('EmailService: Sending email to:', options.to);
      await this.transporter.sendMail(mailOptions);
      console.log('EmailService: Email sent successfully');
    } catch (error) {
      console.error('EmailService: Error sending email:', (error as Error).message);
      throw new Error('Failed to send email');
    }
  }
}
