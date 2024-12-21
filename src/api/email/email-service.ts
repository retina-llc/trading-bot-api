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

  // Welcome Email: Sent when a user signs up
  async sendWelcomeEmail(to: string): Promise<void> {
    const mailOptions = {
      from: '"TerraMa Trading Bot" <no-reply@terramabot.com>',
      to,
      subject: 'Welcome to TerraMa Trading Bot!',
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

  // Subscription Email: Sent when a user pays for a subscription
  async sendSubscriptionEmail(to: string, expiryDate: string): Promise<void> {
    const mailOptions = {
      from: '"TerraMa Trading Bot" <no-reply@terramabot.com>',
      to,
      subject: 'Subscription Confirmation - TerraMa Trading Bot',
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

  private getWelcomeTemplate(): string {
    return `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h1>Welcome to TerraMa Trading Bot!</h1>
        <p>We're excited to have you on board. Start exploring the trading features now.</p>
        <a href="https://terramabot.com" style="padding: 10px; background-color: #4CAF50; color: white; text-decoration: none;">Get Started</a>
      </div>
    `;
  }

  private getSubscriptionTemplate(expiryDate: string): string {
    return `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h1>Subscription Activated!</h1>
        <p>Your subscription has been successfully activated. 🎉</p>
        <p><strong>Subscription Expiry Date:</strong> ${expiryDate}</p>
        <p>Enjoy the full features of TerraMa Trading Bot!</p>
        <a href="https://terramabot.com" style="padding: 10px; background-color: #4CAF50; color: white; text-decoration: none;">Explore Features</a>
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
      from: '"TerraMa Trading Bot" <no-reply@terramabot.com>',
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
