import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  HttpException,
  HttpStatus,
  Req,
  Res,
  Query,
} from '@nestjs/common';
import { RequestWithUser } from '../request-user';
import { LoginService } from './login-service';
import { UserService } from './user-service';
import { AuthGuard } from '../subscription/awt.guard';
import { Response } from 'express';
import { TokenStorage } from './token-storage';
import { JwtPayload } from 'jsonwebtoken';
import { Request,  } from 'express'; // Correctly imported types
import * as jwt from 'jsonwebtoken'; 
import { EmailService } from '../email/email-service'; // Assuming you have an email service
import * as crypto from 'crypto';
@Controller('users')
export class UserController {
  private verificationCodes = new Map<string, string>();

  constructor(
    private readonly userService: UserService,
    private readonly loginService: LoginService,
    private readonly emailService: EmailService,
  ) {}

  @Post('signup')
  async signUp(
    @Body() body: { email: string; password: string; wallet_address: string },
  ) {
    const { email, password, wallet_address } = body;

    console.log('[SignUp] Received signup request:', body);

    if (!email || !password || !wallet_address) {
      console.error('[SignUp] Missing required fields');
      throw new HttpException(
        'Email, password, and wallet address are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      console.log('[SignUp] Registering user...');
      const user = await this.userService.signUp(email, password, wallet_address);
      console.log('[SignUp] User registered successfully:', user);
      return { message: 'User signed up successfully', user };
    } catch (error) {
      const err = error as Error;
      console.error('[SignUp] Error during registration:', err.message);
      throw new HttpException(
        { message: err.message || 'Failed to sign up' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
    @Res() res: Response,
  ) {
    const { email, password } = body;

    console.log('[Login] Received login request');
    console.log('[Login] Request body:', body);

    if (!email || !password) {
      console.error('[Login] Missing email or password');
      throw new HttpException('Email and password are required', HttpStatus.BAD_REQUEST);
    }

    try {
      console.log('[Login] Authenticating user...');
      const token = await this.loginService.login(email, password);
      console.log('[Login] Authentication successful, generated token:', token);

      // Store token in memory
      TokenStorage.setToken(email, token.token);

      // Set token as an HTTP-only cookie
      res.cookie('authToken', token.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'none',
      });

      console.log('[Login] Set authToken cookie with options:', {
        httpOnly: true,
        secure: false,
        sameSite: 'none',
      });

      console.log('[Login] Sending response with status 200');
      return res.status(HttpStatus.OK).json({ message: 'Login successful' });
    } catch (error) {
      const err = error as Error;
      console.error('[Login] Authentication failed:', err.message);
      throw new HttpException(err.message || 'Login failed', HttpStatus.UNAUTHORIZED);
    }
  }

  @Get('profile')
  async getUserProfileWithoutSubscription(@Req() request: Request) {
    const authHeader = request.headers['authorization']; // Correct access to authorization header

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpException('Authorization token is missing or malformed', HttpStatus.UNAUTHORIZED);
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw new HttpException('Authorization token is missing', HttpStatus.UNAUTHORIZED);
    }

    try {
      const secretKey = process.env.JWT_SECRET || 'your_secret_key';
      const decoded = jwt.verify(token, secretKey) as JwtPayload;

      if (!decoded.email) {
        throw new HttpException('Invalid token: email is missing', HttpStatus.UNAUTHORIZED);
      }

      const user = await this.userService.getUserProfile(decoded.email);

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      return { message: 'User profile fetched successfully', userProfile: user };
    } catch (error) {
      throw new HttpException(
        'Invalid or expired token',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }


  @Get('token')
  async getToken(@Query('email') email: string) {
    if (!email) {
      throw new HttpException('Email is required to retrieve token', HttpStatus.BAD_REQUEST);
    }

    const code = crypto.randomInt(100000, 999999).toString();
    this.verificationCodes.set(email, code);

    console.log(`[Token] Sending verification code ${code} to email: ${email}`);

    await this.emailService.sendEmail({
      to: email,
      subject: 'Your Verification Code',
      text: `Your verification code is ${code}.`,
    });

    return { message: 'Verification code sent' };
  }

  @Post('validate-code')
  async validateCode(
    @Body() body: { email: string; code: string },
  ): Promise<{ token: string }> {
    const { email, code } = body;

    if (!email || !code) {
      throw new HttpException(
        'Email and verification code are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const savedCode = this.verificationCodes.get(email);
    if (!savedCode || savedCode !== code) {
      throw new HttpException('Invalid or expired verification code', HttpStatus.BAD_REQUEST);
    }

    const token = TokenStorage.getToken(email);
    if (!token) {
      throw new HttpException('Token not found', HttpStatus.NOT_FOUND);
    }

    this.verificationCodes.delete(email); // Remove the code after validation
    return { token };
  }
}