// ./subscription/awt.guard.ts

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import * as jwt from "jsonwebtoken";
import { UserRepository } from "../user/user-repository";

interface JwtPayload {
  email: string;
  [key: string]: any; // Allow other optional properties
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userRepository: UserRepository, // Inject UserRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Log the incoming request details (optional, use with caution)
    console.log("--- Incoming Request ---");
    console.log(`Method: ${request.method}`);
    console.log(`URL: ${request.url}`);
    console.log(`Headers: ${JSON.stringify(request.headers)}`);
    console.log("------------------------");

    // Extract the Authorization header
    const authHeader = request.headers.authorization;
    console.log("Authorization Header:", authHeader);

    // Check if Authorization header exists and starts with 'Bearer '
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.error("Authorization header missing or malformed.");
      throw new UnauthorizedException(
        "Authorization token is missing or malformed",
      );
    }

    // Extract the token from the header
    const token = authHeader.split(" ")[1];
    console.log("Extracted Token:", token);

    if (!token) {
      console.error("Token extraction failed. Token is undefined.");
      throw new UnauthorizedException("Authorization token is missing");
    }

    try {
      // Verify and decode the token
      const secretKey = process.env.JWT_SECRET || "your_secret_key";
      console.log("Using JWT Secret:", secretKey ? "***SECRET***" : "None");

      const decoded = jwt.verify(token, secretKey) as JwtPayload;

      console.log("Decoded Token:", decoded);

      if (!decoded.email) {
        console.error("Decoded token does not contain email.");
        throw new UnauthorizedException("Invalid token: email is missing");
      }

      // Fetch the user from the database
      const user = await this.userRepository.findByEmail(decoded.email);
      console.log("Fetched User:", user ? user.email : "User not found");

      if (!user) {
        console.error("User not found in the database.");
        throw new UnauthorizedException("User not found");
      }

      if (!user.has_subscription) {
        console.error("User does not have an active subscription.");
        throw new UnauthorizedException(
          "Active subscription is required to access this resource",
        );
      }

      // Attach the user to the request object
      request.user = user;
      console.log("User attached to request:", user.email);

      return true;
    } catch (error) {
      // Log the specific error message
      console.error("Token verification failed:", (error as Error).message);
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
