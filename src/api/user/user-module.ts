import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user-service';
import { User } from './user-entity';
import { UserController } from './user-controller';
import { UserRepository } from './user-repository';
import { EmailModule } from '../email/email-module';
import { LoginService } from './login-service';
import { JwtModule } from '@nestjs/jwt'; // Import JwtModule
import { ConfigModule } from '@nestjs/config'; // Import ConfigModule (optional for managing environment variables)

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    EmailModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'defaultSecret', // Use an environment variable for production
      signOptions: { expiresIn: '1h' }, // Token expiration
    }),
    ConfigModule, // Optional: If you use environment variables
  ],
  providers: [UserService, UserRepository, LoginService],
  controllers: [UserController],
  exports: [UserService, UserRepository, LoginService],
})
export class UserModule {}
