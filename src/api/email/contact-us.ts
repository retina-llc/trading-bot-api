// src/contact-us/contact-us.controller.ts

import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { EmailService } from "../email/email-service";
import { ConfigService } from "@nestjs/config"; // If using @nestjs/config

@Controller("contact-us")
export class ContactUsController {
  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService, // If using @nestjs/config
  ) {}

  /**
   * POST /contact-us
   * Accepts name, email, wallet_address, and message from the front end.
   * Sends an email to the admin/support address defined in your env variables.
   */
  @Post()
  async handleContactForm(
    @Body()
    body: {
      name: string;
      email: string;
      wallet_address: string;
      message: string;
    },
  ): Promise<{ message: string }> {
    const { name, email, wallet_address, message } = body;
    console.log("[ContactUs] Received form data:", body);

    // Basic validation (customize as needed)
    if (!name || !email || !wallet_address || !message) {
      throw new HttpException(
        "All fields are required.",
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // If using @nestjs/config
      const adminEmail =
        this.configService.get<string>("CONTACT_US_EMAIL") ||
        this.configService.get<string>("EMAIL_USER");

      // If not using @nestjs/config, uncomment the following line and comment the above line
      // const adminEmail = process.env.CONTACT_US_EMAIL || process.env.EMAIL_USER;

      if (!adminEmail) {
        console.error(
          "[ContactUs] Neither CONTACT_US_EMAIL nor EMAIL_USER environment variables are set.",
        );
        throw new HttpException(
          "Server configuration error: Admin email is not set.",
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Construct the email subject/body
      const subject = `New Contact Form Submission from ${name}`;
      const htmlContent = `
        <div style="font-family: Arial, sans-serif;">
          <h2>Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Wallet Address:</strong> ${wallet_address}</p>
          <p><strong>Message:</strong> ${message}</p>
        </div>
      `;

      // Use your EmailService to send
      await this.emailService.sendEmail({
        to: adminEmail, // Now guaranteed to be a string
        subject,
        html: htmlContent,
      });

      console.log(
        "[ContactUs] Contact form email sent successfully to admin:",
        adminEmail,
      );
      return {
        message:
          "Your message was sent successfully. We will get back to you soon!",
      };
    } catch (error) {
      console.error(
        "[ContactUs] Error sending contact form email:",
        (error as Error).message,
      );
      throw new HttpException(
        "Failed to send your message. Please try again later.",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
